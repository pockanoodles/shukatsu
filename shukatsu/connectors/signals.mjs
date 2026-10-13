/**
 * From records to signals: the step that runs after every sync.
 *
 * Each new message (and each calendar event that talks about an interview)
 * goes through the upstream matchers. reply-matcher's classifyReply and
 * invite-match's classifyEmail decide what the message is, and matchCandidates
 * (with analyzeInvite's company reading as a second opinion) finds the tracker
 * row it is about. The result is a signal row in sync.db with the action it
 * proposes.
 *
 * Why signals and not proposals: the review queue's proposals table only takes
 * the kinds in core/proposals.mjs (record edits and postings), and a status change
 * or an event is neither. So a signal sits in sync.db with its proposed
 * action, the inbox operations expose it, and acting on it is the candidate or an
 * agent calling the ordinary operations (tracker.setStatus, event.create,
 * posting.add), which keep their own permissions, logging, and stamps. Nothing
 * here writes the tracker, the calendar, or the pipeline.
 *
 * The email is untrusted text. It decides which category a message falls in
 * and which row it matches, and nothing else: every field in a proposed action is
 * built from the tracker (company, number) or from a value checked here (a
 * YYYY-MM-DD date), never copied from the message, so an instruction hidden in
 * an email can't reach an operation's input.
 */

import { classifyReply, matchCandidates } from '../../reply-matcher.mjs';
import { analyzeInvite } from '../../invite-match.mjs';
import { db } from '../core/store.mjs';
import { listCampaigns } from '../core/campaigns.mjs';
import { readTracker } from '../core/tracker.mjs';
import { addSignal, markProcessed, unprocessedRecords } from '../core/sync.mjs';
import { registrable } from './gmail/query.mjs';

const ASSESSMENT = /assessment|online test|coding (test|challenge)|take[- ]home|hackerrank|codesignal|hirevue|webテスト|適性検査|spi|玉手箱|オンラインテスト/i;
const SCHOOL = /(^|\.)(symplicity\.com|joinhandshake\.com|careerforum\.net)$/;
const POSTING_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|workable\.com)$/;
const EVENT_INTERVIEW = /interview|面接|選考/i;

const ACTIVE = new Set(['Evaluated', 'Applied', 'Responded']);
const CLOSED = new Set(['Rejected', 'Discarded', 'Hired', 'SKIP']);

const cap = (confidence, max) => (['low', 'medium', 'high'].indexOf(confidence) > ['low', 'medium', 'high'].indexOf(max) ? max : confidence);

/** What kind of message this is, from the two upstream classifiers. */
export function kindOf({ from, subject, text }) {
  const body = String(text || '').slice(0, 4000);
  const reply = classifyReply({ from, subject, body_snippet: body });
  const email = analyzeInvite(`${subject}\n${body}`, []);
  if (reply.type === 'Noise') return { kind: 'noise', strong: true, email };
  if (reply.type === 'Rejected' || email.classification === 'rejection') return { kind: 'rejection', strong: email.phraseStrength === 'strong', email };
  if (reply.type === 'Offer') return { kind: 'offer', strong: true, email };
  // An invitation often opens with "thank you for applying", which the reply matcher files as a confirmation.
  if (email.classification === 'invite' || reply.type === 'Interview') return { kind: 'interview', strong: true, email };
  if (reply.type === 'Need Action') {
    if (reply.suggestedTrackerUpdate === 'Interview') return { kind: 'interview', strong: false, email };
    return { kind: ASSESSMENT.test(`${subject} ${body}`) ? 'assessment' : 'other', strong: false, email };
  }
  if (reply.type === 'Auto-confirmation') return { kind: 'confirmation', strong: true, email };
  return { kind: 'other', strong: false, email };
}

const NEXT = { interview: 'Interview', rejection: 'Rejected', offer: 'Offer', assessment: 'Responded', confirmation: 'Applied' };
const SAYS = {
  interview: 'An interview invitation arrived by email.',
  rejection: 'A rejection arrived by email.',
  offer: 'An offer arrived by email.',
  assessment: 'An assessment request arrived by email.',
  confirmation: 'A confirmation of the application arrived by email.',
};

/** Whether moving this row to the state the message implies is a step forward from where it is. */
function worthProposing(kind, status) {
  if (kind === 'rejection' || kind === 'offer') return !CLOSED.has(status) && status !== NEXT[kind];
  if (kind === 'interview') return ACTIVE.has(status);
  if (kind === 'assessment') return status === 'Evaluated' || status === 'Applied';
  if (kind === 'confirmation') return status === 'Evaluated';
  return false;
}

/**
 * The signal for one record, from the records alone (`rows` is the tracker,
 * `campaigns` the active campaigns, `campaignOf` maps a tracker number to
 * its campaign). Pure, so it is easy to test.
 */
export function signalFor(record, { rows, campaigns = [], campaignOf = new Map() }) {
  const f = record.fields || {};
  const isEvent = record.kind === 'event';
  const from = isEvent ? '' : f.from || '';
  const subject = isEvent ? f.summary || '' : f.subject || '';
  const text = record.text || '';

  let kind;
  let strong = false;
  let email = null;
  if (isEvent) {
    if (!EVENT_INTERVIEW.test(subject)) return null;
    ({ kind, strong } = { kind: 'interview', strong: false });
  } else {
    ({ kind, strong, email } = kindOf({ from, subject, text }));
  }

  // The tracker row it is about.
  const body = text.slice(0, 4000);
  const [m] = matchCandidates([{ message_id: String(record.id ?? record.external_id), from, subject, body_snippet: body, received_at: f.received_at }], rows);
  let num = m?.application_num ?? null;
  let confidence = m?.confidence || 'low';
  if (!num && email?.candidates?.length === 1 && email.candidates[0].nameScore >= 1) {
    num = email.candidates[0].appNumber;
    confidence = 'medium';
  }
  const row = num ? rows.find((r) => r.num === num) : null;
  if (!row) confidence = 'low';
  if (kind === 'rejection' && !strong) confidence = cap(confidence, 'medium');
  if (isEvent) confidence = cap(confidence, 'medium');

  // The campaign: through the row, or by the page the message points at.
  let campaignId = row ? campaignOf.get(row.num) ?? null : null;
  if (!campaignId && campaigns.length) {
    const hosts = new Set([...(f.links || []).map((l) => { try { return registrable(new URL(l).hostname); } catch { return null; } }), from.match(/@([\w.-]+)/)?.[1] && registrable(from.match(/@([\w.-]+)/)[1])].filter(Boolean));
    campaignId = campaigns.find((c) => { try { return c.url && hosts.has(registrable(new URL(c.url).hostname)); } catch { return false; } })?.id ?? null;
  }

  // What it proposes, built only from trusted values.
  const actions = [];
  const hints = {};
  if (email?.signals?.date && /^\d{4}-\d{2}-\d{2}$/.test(email.signals.date)) hints.date = email.signals.date;
  if (email?.signals?.platform) hints.platform = email.signals.platform;
  if (row && NEXT[kind] && (confidence === 'high' || confidence === 'medium') && worthProposing(kind, row.status)) {
    actions.push({ op: 'tracker.setStatus', input: { num: row.num, state: NEXT[kind], note: SAYS[kind] } });
    if (kind === 'interview' && hints.date) {
      actions.push({
        op: 'event.create',
        input: { kind: 'interview', title: `Interview: ${row.company}`, start: hints.date, tracker_num: row.num, ...(campaignId ? { campaign_id: campaignId } : {}), source_ref: `${record.connector || 'mail'}:${record.external_id}`, note: 'From an email invitation. The time is in the email.' },
      });
    }
  }
  if (!row && kind === 'other' && !isEvent) {
    const host = (() => { try { return new URL(f.links?.find((l) => { try { return POSTING_HOST.test(new URL(l).hostname); } catch { return false; } })).hostname; } catch { return null; } })();
    const fromSchool = SCHOOL.test(String(from.match(/@([\w.-]+)/)?.[1] || ''));
    if (host && fromSchool) actions.push({ op: 'posting.add', input: { url: f.links.find((l) => { try { return new URL(l).hostname === host; } catch { return false; } }) } });
  }

  const matched = row ? { num: row.num, company: row.company, role: row.role, status: row.status } : null;
  let status = 'open';
  // Noise and settled confirmations close themselves. An unmatched invitation or rejection stays open: it matters most when nothing knows where it belongs.
  if (kind === 'noise' || (kind === 'confirmation' && !actions.length) || (kind === 'other' && !row && !campaignId && !actions.length)) status = 'dismissed';
  return { kind, tracker_num: row?.num ?? null, campaign_id: campaignId, confidence, status, proposed: actions.length || matched || Object.keys(hints).length ? { actions, matched, hints } : null };
}

/** Run every record no one has read yet. Returns the signals created. */
export function processRecords(root) {
  const records = unprocessedRecords(root);
  if (!records.length) return [];
  let rows = [];
  try { rows = readTracker(root).rows; } catch { /* no tracker yet */ }
  let campaigns = [];
  let campaignOf = new Map();
  try {
    campaigns = listCampaigns(root);
    for (const r of db(root).prepare('SELECT campaign_id, tracker_num FROM campaign_rows ORDER BY added_at').all()) campaignOf.set(r.tracker_num, r.campaign_id);
  } catch { campaignOf = new Map(); }
  const made = [];
  for (const record of records) {
    try {
      const s = signalFor(record, { rows, campaigns, campaignOf });
      if (s) made.push(addSignal(root, { record_id: record.id, ...s }));
    } catch (err) {
      console.error(`shukatsu: could not read record ${record.id} for signals: ${err.message}`);
    } finally {
      markProcessed(root, record.id);
    }
  }
  return made;
}
