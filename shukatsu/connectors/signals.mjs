/**
 * From records to signals: the step that runs after every sync.
 *
 * Each new message (and each calendar event that talks about an interview)
 * goes through the upstream matchers. A page the browser extension read goes
 * through pageSignal instead. reply-matcher's classifyReply and
 * invite-match's classifyEmail decide what the message is (Japanese mail, which
 * they don't read, goes by its set phrases here first), and matchCandidates
 * finds the tracker row it is about. Around them this step adds what a fair
 * season's mailbox needs: a company's Japanese name from targets.yml, a choice
 * between one company's several rows, and a board's mail speaking only for the
 * rows that went through that board. The result is a signal row in sync.db
 * with the action it proposes.
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

import { readFileSync } from 'fs';
import { join } from 'path';
import { loadYaml } from '../../lib/yaml-document.mjs';
import { checkCompanyMatch, classifyReply, matchCandidates, normalizeStr } from '../../reply-matcher.mjs';
import { analyzeInvite } from '../../invite-match.mjs';
import { db } from '../core/store.mjs';
import { listCampaigns } from '../core/campaigns.mjs';
import { readPipeline, readTracker } from '../core/tracker.mjs';
import { normalizeUrl } from '../../url-key.mjs';
import { addSignal, markProcessed, unprocessedRecords } from '../core/sync.mjs';
import { registrable } from './gmail/query.mjs';
import { fromBoard, isPostingLink, platformNamed, platformOfSender, platformOfUrl } from '../platforms/index.mjs';

const ASSESSMENT = /assessment|online test|coding (test|challenge)|take[- ]home|hackerrank|codesignal|hirevue|webテスト|適性検査|\bspi\b|玉手箱|オンラインテスト/i;
const EVENT_INTERVIEW = /interview|面接|選考/i;

/**
 * Japanese recruiting mail, which the upstream classifiers don't read. Its
 * idioms are set phrases: a rejection wishes the candidate well (お祈り) or
 * says it can't meet their hopes, an invitation names the interview or the
 * next stage of 選考, and an offer announces a 内定 (an event for 内定者 is
 * not one). A board's newsletter gives itself away by its unsubscribe line.
 */
const JA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const JA_REJECTION = /お祈り(申し上げ|いたし)|ご(期待|希望)に(沿|添)え(ない|かね)|ご縁がなかった|見送(り|らせて)|不採用/;
const JA_OFFER = /内々?定(のご連絡|のお知らせ|が決定|を(お出し|出させて))|採用(内定|決定)のご連絡/;
const JA_INTERVIEW = /面接(のご案内|のお知らせ|日程|の日程|のご予約|についてのご連絡)|面談のご案内|(一次|二次|三次|最終|個人)面接|次(回|の)選考(のご案内|へのご案内|にお進み|に進|へ進)|選考を?通過|通過(されました|のお知らせ|となりました|いたしました)/;
const JA_CONFIRMATION = /(エントリー|ご応募|応募)(を|の)?(受け付けました|受付(完了|いたしました)|完了(しました|いたしました)|ありがとうございま)/;
const JA_NEWSLETTER = /配信停止|配信解除|メールマガジン|メルマガ|おすすめ(の)?求人|新着求人/;
/** Moving an interview is not turning the candidate down, whatever "unfortunately" it opens with. */
const RESCHEDULE = /\breschedul|\b(new|another|different) (date|time|slot)\b|\bmove your interview|日程の?(変更|再調整)|日時の?変更/i;

const ACTIVE = new Set(['Evaluated', 'Applied', 'Responded']);
const CLOSED = new Set(['Rejected', 'Discarded', 'Hired', 'SKIP']);
/** The states of a row that was actually sent, and the news that only ever follows sending. */
const SENT = new Set(['Applied', 'Responded', 'Interview', 'Offer']);
const AFTER_SENDING = new Set(['rejection', 'interview', 'assessment', 'offer']);

const cap = (confidence, max) => (['low', 'medium', 'high'].indexOf(confidence) > ['low', 'medium', 'high'].indexOf(max) ? max : confidence);

/** What kind of message this is: Japanese mail by its set phrases, the rest by the two upstream classifiers. */
export function kindOf({ from, subject, text }) {
  const body = String(text || '').slice(0, 4000);
  const all = `${subject}\n${body}`;
  const email = analyzeInvite(all, []);
  const found = (JA.test(all) && kindOfJa(all, from)) || kindOfReply({ from, subject, body }, email);
  if (found.kind === 'rejection' && RESCHEDULE.test(all)) return { kind: 'interview', strong: false, email };
  return { ...found, email };
}

function kindOfJa(all, from) {
  if (JA_NEWSLETTER.test(all) && fromBoard(from)) return { kind: 'noise', strong: true };
  if (JA_REJECTION.test(all)) return { kind: 'rejection', strong: true };
  if (JA_OFFER.test(all)) return { kind: 'offer', strong: true };
  if (JA_INTERVIEW.test(all)) return { kind: 'interview', strong: true };
  if (ASSESSMENT.test(all)) return { kind: 'assessment', strong: false };
  if (JA_CONFIRMATION.test(all)) return { kind: 'confirmation', strong: true };
  if (JA_NEWSLETTER.test(all)) return { kind: 'noise', strong: true };
  return null;
}

function kindOfReply({ from, subject, body }, email) {
  const reply = classifyReply({ from, subject, body_snippet: body });
  if (reply.type === 'Noise') return { kind: 'noise', strong: true };
  if (reply.type === 'Rejected' || email.classification === 'rejection') return { kind: 'rejection', strong: email.phraseStrength === 'strong' };
  if (reply.type === 'Offer') return { kind: 'offer', strong: true };
  // An invitation often opens with "thank you for applying", which the reply matcher files as a confirmation.
  if (email.classification === 'invite' || reply.type === 'Interview') return { kind: 'interview', strong: true };
  if (reply.type === 'Need Action') {
    if (reply.suggestedTrackerUpdate === 'Interview') return { kind: 'interview', strong: false };
    return { kind: ASSESSMENT.test(`${subject} ${body}`) ? 'assessment' : 'other', strong: false };
  }
  if (reply.type === 'Auto-confirmation') return { kind: 'confirmation', strong: true };
  return { kind: 'other', strong: false };
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

// ---------------------------------------------------------------- which row

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A title's words: Latin ones of four characters or more (a year counts), and runs of Japanese, which has no spaces. */
const wordsOf = (s) => String(s || '').normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 || (/[^\x00-\x7f]/.test(w) && w.length >= 2));
/** Whether a text uses a word: whole in Latin script, anywhere in Japanese. */
const usesWord = (text, w) => (/^[\p{Script=Latin}\p{N}]+$/u.test(w)
  ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
  : text.includes(w));
/** Recruiting words that sign every email, so they tell no row from another. */
const GENERIC = new Set(['talent', 'acquisition', 'specialist', 'coordinator', 'operations', 'recruiter', 'recruiting', 'human', 'resources', 'people']);

/**
 * A row's role without its company's own name. Upstream counts any word of the
 * title as a role match, so a title that names its company ("2027 Acme Summer
 * Internship") matched every message from that company.
 */
function roleOnly(row) {
  const own = new Set(wordsOf(row.company).map((w) => w.toLowerCase()));
  const kept = String(row.role || '').split(/\s+/).filter((t) => !own.has(t.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));
  return kept.join(' ').trim() || row.role;
}

/** Words of a row's role that none of its company's other rows share. */
function ownWords(row, siblings) {
  const others = new Set(siblings.filter((s) => s !== row).flatMap((s) => wordsOf(roleOnly(s))).map((w) => w.toLowerCase()));
  return wordsOf(roleOnly(row)).filter((w) => !others.has(w.toLowerCase()) && !GENERIC.has(w.toLowerCase()));
}

/** Every row of the one company a message names, when it names exactly one and that company has several rows. */
function siblingsIn(text, rows) {
  const keys = new Set(rows.filter((r) => checkCompanyMatch(text, r.company)).map((r) => normalizeStr(r.company)));
  if (keys.size !== 1) return [];
  const all = rows.filter((r) => keys.has(normalizeStr(r.company)));
  return all.length > 1 ? all : [];
}

/** One of a company's rows: the one whose own words the message uses, or, for news that only follows sending, the only one sent. */
function chooseSibling(text, siblings, kind) {
  const scored = siblings.map((row) => ({ row, n: ownWords(row, siblings).filter((w) => usesWord(text, w)).length }));
  const best = Math.max(...scored.map((s) => s.n));
  const top = scored.filter((s) => s.n === best).map((s) => s.row);
  if (best > 0 && top.length === 1) return top[0];
  const sent = top.filter((r) => SENT.has(r.status));
  return AFTER_SENDING.has(kind) && sent.length === 1 ? sent[0] : null;
}

/** The boards and systems a row went through: its Via cell, and the hosts of its URL and of the links in its notes. */
function channelsOf(row) {
  const out = new Set();
  const via = platformNamed(row.via);
  if (via) out.add(via.id);
  for (const url of [row.url, ...(String(row.notes || '').match(/https?:\/\/[^\s)|]+/g) || [])]) {
    const p = url ? platformOfUrl(url) : null;
    if (p) out.add(p.id);
  }
  return out;
}

/** The tracker's names for the companies a message calls by another name (targets.yml `ja`). */
function namesFor(text, aliases) {
  const t = text.normalize('NFKC');
  return [...aliases].filter(([, names]) => names.some((n) => t.includes(String(n).normalize('NFKC')))).map(([company]) => company);
}

const SUFFIX = /[\s,]+(l\.?\s?p\.?|group|holdings|inc\.?|ltd\.?|llc|corp(oration)?\.?|co\.?|japan|株式会社)$/i;
const companyKey = (name) => {
  let s = String(name || '').trim();
  for (let i = 0; i < 3 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, '');
  return normalizeStr(s);
};

/**
 * Other names for each tracked company, from the data root's targets.yml
 * (`ja: [グローベックス証券]` on a company), keyed by the name the tracker uses. Mail in
 * Japanese names a company in Japanese; the tracker names it in English.
 */
export function companyAliases(root, rows) {
  const companies = loadYaml(readFileSync(join(root, 'data', 'targets.yml'), 'utf-8'))?.companies || [];
  const out = new Map();
  for (const row of rows) {
    const entry = companies.find((c) => companyKey(c.name) === companyKey(row.company));
    const names = [].concat(entry?.ja ?? []).map(String).filter(Boolean);
    if (names.length) out.set(row.company, names);
  }
  return out;
}

/**
 * The signal for a page the browser extension read. Only a posting makes one,
 * and only when neither the tracker nor the pipeline already has its URL: the
 * candidate opened it, so offering to save it is one press. The action names
 * the record, never its text, so nothing on the page reaches an operation's
 * input. Other pages (an applications list, a thread) are kept for the board
 * readers and make no signal yet.
 */
export function pageSignal(record, { rows, filed = new Set() }) {
  const f = record.fields || {};
  if (f.page !== 'posting' || !f.url) return null;
  const key = normalizeUrl(f.url) || f.url;
  const row = rows.find((r) => r.url && (normalizeUrl(r.url) || r.url) === key);
  if (row || filed.has(key)) return null;
  return {
    kind: 'posting', tracker_num: null, campaign_id: null, confidence: 'high', status: 'open',
    proposed: { actions: [{ op: 'posting.capture', input: { record: record.id } }], matched: null, hints: { platform: f.platform } },
  };
}

/**
 * The signal for one record, from the records alone (`rows` is the tracker,
 * `campaigns` the active campaigns, `campaignOf` maps a tracker number to
 * its campaign, `aliases` a company's other names). Pure, so it is easy to test.
 */
export function signalFor(record, { rows, campaigns = [], campaignOf = new Map(), aliases = new Map() }) {
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

  // The tracker row it is about. A company the message names in Japanese is also given its tracker name.
  const aka = namesFor(`${subject}\n${text}`, aliases);
  const body = `${text.slice(0, 4000)}${aka.length ? `\n${aka.join('\n')}` : ''}`;
  const context = `${from} ${subject} ${body}`.normalize('NFKC');
  // A board writes about its own business (recommendations, newsletters, applications made on it), so its
  // mail speaks only for rows that went through that board, or whose channel the tracker doesn't record.
  const board = fromBoard(from) ? platformOfSender(from) : null;
  const pool = board ? rows.filter((r) => { const c = channelsOf(r); return !c.size || c.has(board.id); }) : rows;
  const [m] = matchCandidates([{ message_id: String(record.id ?? record.external_id), from, subject, body_snippet: body, received_at: f.received_at }], pool.map((r) => ({ ...r, role: roleOnly(r) })));
  let num = m?.application_num ?? null;
  let confidence = m?.confidence || 'low';
  // Upstream scores each row on its own, so one company's rows tie. Choose between them here, or list them.
  const siblings = num ? [] : siblingsIn(context, pool);
  const chosen = siblings.length ? chooseSibling(context, siblings, kind) : null;
  if (chosen) {
    num = chosen.num;
    confidence = 'medium';
  }
  const choices = siblings.length && !chosen ? siblings.filter((r) => !CLOSED.has(r.status)).map((r) => r.num) : [];
  const row = num ? rows.find((r) => r.num === num) : null;
  if (!row) confidence = 'low';
  if (kind === 'rejection' && !strong) confidence = cap(confidence, 'medium');
  if (isEvent) confidence = cap(confidence, 'medium');
  // A board's mail about a company applied to some other way is the board's news, not the application's.
  if (!row && board && NEXT[kind] && rows.some((r) => !pool.includes(r) && checkCompanyMatch(context, r.company))) kind = 'other';

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
    const link = (f.links || []).find(isPostingLink);
    if (link && fromBoard(from)) actions.push({ op: 'posting.add', input: { url: link } });
  }

  const matched = row ? { num: row.num, company: row.company, role: row.role, status: row.status } : null;
  let status = 'open';
  // Noise and settled confirmations close themselves. An unmatched invitation or rejection stays open: it matters most when nothing knows where it belongs.
  if (kind === 'noise' || (kind === 'confirmation' && !actions.length) || (kind === 'other' && !row && !campaignId && !actions.length)) status = 'dismissed';
  return { kind, tracker_num: row?.num ?? null, campaign_id: campaignId, confidence, status, proposed: actions.length || matched || choices.length || Object.keys(hints).length ? { actions, matched, ...(choices.length ? { choices } : {}), hints } : null };
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
  let filed = new Set();
  try { filed = new Set(readPipeline(root).map((x) => normalizeUrl(x.url) || x.url)); } catch { /* no pipeline yet */ }
  let aliases = new Map();
  try { aliases = companyAliases(root, rows); } catch { /* no targets.yml */ }
  const made = [];
  for (const record of records) {
    try {
      const s = record.kind === 'page' ? pageSignal(record, { rows, filed }) : signalFor(record, { rows, campaigns, campaignOf, aliases });
      if (s) made.push(addSignal(root, { record_id: record.id, ...s }));
    } catch (err) {
      console.error(`shukatsu: could not read record ${record.id} for signals: ${err.message}`);
    } finally {
      markProcessed(root, record.id);
    }
  }
  return made;
}
