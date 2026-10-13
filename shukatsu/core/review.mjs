/**
 * The review queue: everything waiting on the candidate, in one list.
 *
 *   draft:entity:<id>             a role, project, or school drafted from sources
 *   draft:fact:<id>               an achievement drafted from sources
 *   draft:variant:<id>/<key>      an archetype-specific wording of a fact
 *   draft:ja:<id>                 a fact's Japanese text
 *   proposal:<n>                  a change someone proposed (core/proposals.mjs)
 *   packet:<n>                    an application packet submitted for approval
 *
 * Decisions, all owner-only, all through core/profile-edit.mjs:
 *
 *   accept          confirm as written, or with an edited wording. A wording
 *                   whose numbers changed is a new statement by the candidate:
 *                   its evidence becomes its review-log line (provenance U).
 *   narrative       keep it, but not as a quantified claim: the new wording must
 *                   drop the figures in question.
 *   cannot-confirm  "I don't know." Durable: never used, never re-asked as if new,
 *                   and never promoted back to a claim by reuse.
 *   reject          not true, or not worth keeping. Kept with the reason, never
 *                   deleted, and reopenable.
 *
 * Those four are the Confirmation UX invariant from AGENTS.md: a figure is
 * never shown with only confirm/deny, because a confirmed guess launders the
 * guess into a "verified" fact.
 */

import {
  BULLET_SECTIONS, entityLive, isActive, isPending, isVerified, jaNumberDiff, loadProfile, numberDiff, quantities, sameJaNumbers, sameNumbers, slug, statusOf, today,
} from './facts.mjs';
import { lintWording } from './validate.mjs';
import { editProfile } from './profile-edit.mjs';
import { decidedProposals, getProposal, isStale, openProposals } from './proposals.mjs';
import { appendPipeline, readTracker } from './tracker.mjs';
import { assertCan, getUser } from './people.mjs';
import { commentCounts, db, json, logActivity, now } from './store.mjs';
import { readManifest } from './manifests.mjs';

const hasNumbers = (t) => quantities(t).length > 0;

function entityView(e) {
  if (!e) return null;
  return { id: e.id, label: e.label, heading: e.heading, title: e.title || null, dates: e.dates || null, section: e.section, ended: e.ended, live: entityLive(e), status: statusOf(e), review_status: e.review_status ?? 'verified' };
}

function factView(f) {
  return {
    id: f.id, text: f.text, tags: f.tags || [], provenance: f.provenance || null, priority: f.priority ?? 2,
    pin: Boolean(f.pin), status: statusOf(f), review_status: f.review_status ?? 'verified', reason: f.reason || null,
    evidence: f.evidence ? { source: f.evidence.source || null, line: f.evidence.line ?? null, quote: f.evidence.quote || null } : null,
    variants: (f.variants || []).map((v) => ({ key: v.key, for: v.for || [], text: v.text, review_status: v.review_status ?? 'verified', status: statusOf(v) })),
    ja: f.ja?.text ? { text: f.ja.text, review_status: f.ja.review_status ?? 'verified', status: statusOf(f.ja), note: f.ja.note || null } : null,
  };
}

function checksFor(root, text, entity) {
  if (!text || !entity || !BULLET_SECTIONS.has(entity.section)) return [];
  return lintWording(root, text, { current: entity.ended === false });
}

/** Profile drafts, in profile order: each role first, then its facts. */
function drafts(root, p) {
  const items = [];
  for (const e of p._entities) {
    if (isPending(e)) {
      items.push({
        key: `draft:entity:${e.id}`, kind: 'entity', source: 'profile', entity: entityView(e), fact: null,
        before: null, after: [e.heading, e.title, e.dates].filter(Boolean).join(' · '), hasNumbers: false,
        evidence: e.evidence || null, checks: [], warnings: [],
      });
    }
    for (const f of e.facts || []) {
      if (!isActive(f)) continue;
      const warnings = [];
      if (!entityLive(e)) warnings.push({ code: 'entity-pending', entity: e.label });
      if (isPending(f)) {
        items.push({
          key: `draft:fact:${f.id}`, kind: 'fact', source: 'profile', entity: entityView(e), fact: factView(f),
          before: null, after: f.text, hasNumbers: hasNumbers(f.text), evidence: f.evidence || null,
          checks: checksFor(root, f.text, e), warnings,
        });
      }
      for (const v of (f.variants || []).filter(isPending)) {
        const w = [...warnings];
        if (!isVerified(f)) w.push({ code: 'fact-pending', fact: f.id });
        if (!sameNumbers(v.text, f.text)) w.push({ code: 'variant-numbers', diff: numberDiff(f.text, v.text), blocking: true });
        items.push({
          key: `draft:variant:${f.id}/${v.key}`, kind: 'variant', source: 'profile', entity: entityView(e), fact: factView(f),
          variant: { key: v.key, for: v.for || [] }, before: f.text, after: v.text, hasNumbers: hasNumbers(v.text),
          evidence: f.evidence || null, checks: checksFor(root, v.text, e), warnings: w,
        });
      }
      if (f.ja?.text && isPending(f.ja)) {
        const w = [...warnings];
        if (!isVerified(f)) w.push({ code: 'fact-pending', fact: f.id });
        if (!sameJaNumbers(f.text, f.ja.text)) w.push({ code: 'ja-numbers', diff: jaNumberDiff(f.text, f.ja.text) });
        items.push({
          key: `draft:ja:${f.id}`, kind: 'ja', source: 'profile', entity: entityView(e), fact: factView(f),
          before: f.text, after: f.ja.text, hasNumbers: hasNumbers(f.ja.text), note: f.ja.note || null,
          evidence: f.ja.source ? { source: f.ja.source, line: null, quote: null } : null, checks: [], warnings: w,
        });
      }
    }
  }
  for (const key of ['summary', 'certifications']) {
    for (const f of (p[key] || []).filter(isPending)) {
      items.push({
        key: `draft:fact:${f.id}`, kind: 'fact', source: 'profile', entity: { id: key, label: key, heading: key, section: key },
        fact: factView(f), before: null, after: f.text, hasNumbers: hasNumbers(f.text), evidence: f.evidence || null, checks: [], warnings: [],
      });
    }
  }
  return items;
}

function proposalItem(root, p, pr) {
  const author = { id: pr.author_id, name: pr.author_name, role: pr.author_role };
  const base = { key: `proposal:${pr.id}`, source: 'proposal', proposal: pr.id, author, created_at: pr.created_at, note: pr.note, warnings: [], checks: [] };
  const hit = pr.payload.id ? p._facts.get(pr.payload.id) : null;
  const entity = hit?.entity || p._entities.find((x) => x.id === pr.payload.entity) || null;
  if (pr.kind === 'fact.edit') {
    const stale = isStale(root, pr);
    const current = hit ? (pr.payload.part === 'ja' ? hit.fact.ja?.text : pr.payload.part ? (hit.fact.variants || []).find((v) => v.key === pr.payload.part)?.text : hit.fact.text) : null;
    const warnings = [];
    if (stale) warnings.push({ code: 'stale', current });
    if (pr.payload.part !== 'ja' && hit && !sameNumbers(pr.payload.text, hit.fact.text)) warnings.push({ code: 'numbers-changed', diff: numberDiff(hit.fact.text, pr.payload.text) });
    return {
      ...base, kind: 'proposal.fact.edit', entity: entityView(entity), fact: hit ? factView(hit.fact) : null, part: pr.payload.part,
      before: pr.base?.text ?? current, current, after: pr.payload.text, hasNumbers: hasNumbers(pr.payload.text),
      checks: pr.payload.part === 'ja' ? [] : checksFor(root, pr.payload.text, entity), warnings, evidence: hit?.fact.evidence || null,
    };
  }
  if (pr.kind === 'fact.new') {
    return {
      ...base, kind: 'proposal.fact.new', entity: entityView(entity), fact: null, before: null, after: pr.payload.text,
      ja: pr.payload.ja, tags: pr.payload.tags, priority: pr.payload.priority, hasNumbers: hasNumbers(pr.payload.text),
      checks: checksFor(root, pr.payload.text, entity),
    };
  }
  if (pr.kind === 'fact.retire') {
    return { ...base, kind: 'proposal.fact.retire', entity: entityView(entity), fact: hit ? factView(hit.fact) : null, before: pr.base?.text, after: null, reason: pr.payload.reason, hasNumbers: false };
  }
  if (pr.kind === 'entity.new') {
    return { ...base, kind: 'proposal.entity.new', entity: { ...pr.payload, id: null }, fact: null, before: null, after: [pr.payload.heading, pr.payload.title, pr.payload.dates].filter(Boolean).join(' · '), hasNumbers: false };
  }
  return { ...base, kind: 'proposal.posting', posting: pr.payload, before: null, after: pr.payload.url, hasNumbers: false };
}

function packetItems(root) {
  return db(root).prepare(`SELECT pk.*, u.name AS author_name, u.role AS author_role FROM packets pk JOIN users u ON u.id = pk.created_by
    WHERE pk.status = 'in_review' ORDER BY pk.updated_at`).all().map((pk) => ({
    key: `packet:${pk.id}`, kind: 'packet', source: 'packet', packet: pk.id, author: { id: pk.created_by, name: pk.author_name, role: pk.author_role },
    created_at: pk.updated_at, before: null, after: `${pk.company} · ${pk.role}`, company: pk.company, role: pk.role, hasNumbers: false, checks: [], warnings: [],
  }));
}

/** Everything waiting: people's input first (proposals, packets), then profile drafts. */
export function queue(root) {
  const p = loadProfile(root);
  const counts = commentCounts(root);
  const items = [
    ...openProposals(root).map((pr) => proposalItem(root, p, pr)),
    ...packetItems(root),
    ...drafts(root, p),
  ];
  for (const it of items) it.comments = counts.get(it.key) || 0;
  return items;
}

export function item(root, key) {
  return queue(root).find((x) => x.key === key) || null;
}

const clip = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return String(u || ''); } };

/** A short human name for a review/activity subject: fact text, role heading, packet company and role, posting host. */
function labelOf(root, p, subject) {
  try {
    const key = String(subject || '');
    if (/^person:\d+$/.test(key)) return db(root).prepare('SELECT name FROM users WHERE id = ?').get(Number(key.slice(7)))?.name || null;
    if (/^app:\d+$/.test(key)) { const row = readTracker(root).rows.find((r) => Number(r.num) === Number(key.slice(4))); return row ? `${row.company} · ${row.role}` : null; }
    if (/^packet:\d+$/.test(key)) {
      const pk = db(root).prepare('SELECT company, role FROM packets WHERE id = ?').get(Number(key.slice(7)));
      return pk ? `${pk.company} · ${pk.role}` : null;
    }
    if (/^proposal:\d+$/.test(key)) {
      const pr = getProposal(root, Number(key.slice(9)));
      if (!pr) return null;
      if (pr.kind === 'posting') return [pr.payload.company, hostOf(pr.payload.url)].filter(Boolean).join(' · ');
      if (pr.kind === 'entity.new') return clip(pr.payload.label);
      if (pr.kind === 'fact.new') return clip(pr.payload.text);
      const hit = p._facts.get(pr.payload.id);
      return hit ? clip(hit.fact.text) : pr.payload.id;
    }
    const k = parseKey(key);
    if (k.what === 'entity') { const e = p._entities.find((x) => x.id === k.id); return e ? clip(e.label || e.heading) : k.id; }
    const hit = p._facts.get(k.id);
    return hit ? clip(hit.fact.text) : k.id;
  } catch { return null; }
}

/** Human names for a list of subjects: { subject: label }. */
export function labelsFor(root, subjects) {
  const p = loadProfile(root);
  const out = {};
  for (const s of new Set(subjects.filter(Boolean))) { const l = labelOf(root, p, s); if (l) out[s] = l; }
  return out;
}

/** Decided profile drafts and proposals, for the "Decided" view and reopening. */
export function decided(root) {
  const p = loadProfile(root);
  const out = [];
  for (const e of p._entities) {
    if (['rejected', 'cannot-confirm'].includes(statusOf(e))) out.push({ key: `draft:entity:${e.id}`, kind: 'entity', status: statusOf(e), text: e.heading, reason: e.decision_note || null, decided_on: e.decided_on || null, entity: entityView(e) });
    for (const f of e.facts || []) {
      if (['rejected', 'cannot-confirm'].includes(statusOf(f))) out.push({ key: `draft:fact:${f.id}`, kind: 'fact', status: statusOf(f), text: f.text, reason: f.decision_note || null, decided_on: f.decided_on || null, entity: entityView(e) });
      for (const v of f.variants || []) if (['rejected', 'cannot-confirm'].includes(statusOf(v))) out.push({ key: `draft:variant:${f.id}/${v.key}`, kind: 'variant', status: statusOf(v), text: v.text, reason: v.decision_note || null, decided_on: v.decided_on || null, entity: entityView(e) });
      if (f.ja && ['rejected', 'cannot-confirm'].includes(statusOf(f.ja))) out.push({ key: `draft:ja:${f.id}`, kind: 'ja', status: statusOf(f.ja), text: f.ja.text, reason: f.ja.decision_note || null, decided_on: f.ja.decided_on || null, entity: entityView(e) });
    }
  }
  const proposals = decidedProposals(root);
  const labels = labelsFor(root, proposals.map((pr) => `proposal:${pr.id}`));
  return { drafts: out, proposals: proposals.map((pr) => ({ ...pr, label: labels[`proposal:${pr.id}`] || null })) };
}

// ---------------------------------------------------------------- decisions

function parseKey(key) {
  const m = String(key).match(/^draft:(entity|fact|variant|ja):([a-z0-9.-]+)(?:\/([a-z0-9-]+))?$/);
  if (m) return { type: 'draft', what: m[1], id: m[2], part: m[1] === 'ja' ? 'ja' : m[3] || null };
  const pr = String(key).match(/^proposal:(\d+)$/);
  if (pr) return { type: 'proposal', id: Number(pr[1]) };
  const pk = String(key).match(/^packet:(\d+)$/);
  if (pk) return { type: 'packet', id: Number(pk[1]) };
  throw new Error(`Unknown review item "${key}".`);
}

const reasonText = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Apply a reworded statement of `fact` (canonical text). If its figures moved,
 * the candidate is now the source for it: evidence -> review log, provenance U.
 */
function restate(tx, path, fact, text) {
  if (text === fact.text) return;
  tx.set(path, 'text', text);
  if (!sameNumbers(text, fact.text)) {
    tx.set(path, 'evidence', tx.state(text));
    tx.set(path, 'provenance', 'U');
  }
}

function narrativeCheck(before, after) {
  const kept = quantities(after).filter((q) => quantities(before).includes(q));
  if (kept.length) throw new Error(`To keep it as narrative only, drop the figures in question (${kept.join(', ')}) from the wording.`);
}

/**
 * Decide one item. `outcome` is accept | narrative | cannot-confirm | reject.
 * `text` is an edited wording (accept, narrative); `reason` explains a
 * rejection or a can't-confirm.
 */
export function decide(root, { actor, key, outcome, text = null, reason = '' }) {
  assertCan(actor, 'review.decide');
  if (!['accept', 'narrative', 'cannot-confirm', 'reject'].includes(outcome)) throw new Error(`Unknown outcome "${outcome}".`);
  const k = parseKey(key);
  const edited = text == null ? null : String(text).replace(/\s+/g, ' ').trim();
  if (edited === '') throw new Error('The wording is empty.');
  let result;
  if (k.type === 'draft') result = decideDraft(root, actor, k, outcome, edited, reasonText(reason));
  else if (k.type === 'proposal') result = decideProposal(root, actor, k.id, outcome, edited, reasonText(reason));
  else result = decidePacket(root, actor, k.id, outcome, reasonText(reason));
  // Sending a packet back is not a rejection: it keeps its own verb so the feed and the digest can tell them apart.
  const verb = k.type === 'packet' && outcome === 'reject' ? 'review.changes' : `review.${outcome}`;
  logActivity(root, { actor, verb, subject: key, detail: { ...result.detail, commit: result.commit?.sha || null } });
  return result;
}

function decideDraft(root, actor, k, outcome, edited, reason) {
  const p = loadProfile(root);
  const label = k.what === 'entity' ? k.id : k.part && k.part !== 'ja' ? `${k.id}/${k.part}` : k.part === 'ja' ? `${k.id} (ja)` : k.id;
  const verbs = { accept: 'Confirm', narrative: 'Keep as narrative', 'cannot-confirm': 'Mark unconfirmable', reject: 'Reject' };
  const r = editProfile(root, {
    actor, message: `${verbs[outcome]} ${label}`,
    apply: (tx) => {
      const path = tx.path(k.id, k.what === 'entity' || k.what === 'fact' ? null : k.part);
      const node = k.what === 'entity' ? p._entities.find((e) => e.id === k.id)
        : k.what === 'fact' ? p._facts.get(k.id).fact
          : k.what === 'ja' ? p._facts.get(k.id).fact.ja
            : p._facts.get(k.id).fact.variants.find((v) => v.key === k.part);
      if (!node) throw new Error('That item is gone.');
      if (!isPending(node)) throw new Error('That item was already decided.');
      const fact = k.what === 'entity' ? null : p._facts.get(k.id).fact;
      if (outcome === 'reject' || outcome === 'cannot-confirm') {
        if (outcome === 'reject' && !reason) throw new Error('Say why, in a few words. The reason is kept with it.');
        tx.set(path, 'status', outcome === 'reject' ? 'rejected' : 'cannot-confirm');
        tx.set(path, 'decided_on', today());
        tx.set(path, 'decided_by', actor.name);
        if (reason) tx.set(path, 'decision_note', reason);
        return;
      }
      const before = k.what === 'entity' ? null : node.text;
      const wording = edited ?? before;
      if (outcome === 'narrative') narrativeCheck(before, wording);
      if (k.what === 'fact') restate(tx, path, fact, wording);
      else if (k.what === 'variant') {
        if (!sameNumbers(wording, fact.text)) throw new Error(`A variant must carry the same figures as its fact [${quantities(fact.text).join(', ')}]. Change the fact itself to change a figure.`);
        if (wording !== node.text) tx.set(path, 'text', wording);
      } else if (k.what === 'ja') {
        if (wording !== node.text) tx.set(path, 'text', wording);
      }
      tx.set(path, 'review_status', 'verified');
    },
  });
  return { ...r, detail: { kind: k.what, id: k.id, part: k.part, edited: Boolean(edited) } };
}

function nextFactId(p, entityId, text) {
  const words = slug(text).split('-').filter((w) => w.length > 3).slice(0, 2).join('-') || 'fact';
  let id = `${entityId}.${words}`;
  for (let n = 2; p._facts.has(id); n++) id = `${entityId}.${words}-${n}`;
  return id;
}

function decideProposal(root, actor, id, outcome, edited, reason) {
  const pr = getProposal(root, id);
  if (!pr || pr.status !== 'open') throw new Error('That proposal is no longer open.');
  const proposer = getUser(root, pr.author_id);
  const close = (status, result) => db(root).prepare('UPDATE proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, result = ?, updated_at = ? WHERE id = ?')
    .run(status, actor.id, now(), reason || null, json(result), now(), id);

  if (outcome === 'reject' || outcome === 'cannot-confirm') {
    if (outcome === 'reject' && !reason) throw new Error('Say why, in a few words. Whoever proposed it will see the reason.');
    close('rejected', { outcome });
    return { changed: false, detail: { kind: pr.kind, proposal: id, author: proposer?.name } };
  }

  if (pr.kind === 'posting') {
    const added = appendPipeline(root, { url: pr.payload.url, company: pr.payload.company, role: pr.payload.role, note: [pr.payload.note, `suggested by ${proposer.name}`].filter(Boolean).join(' · ') });
    close('accepted', { outcome, pipeline: added ? 'added' : 'already there' });
    return { changed: added, detail: { kind: pr.kind, proposal: id, author: proposer?.name, url: pr.payload.url } };
  }

  const p = loadProfile(root);
  const wording = edited ?? pr.payload.text;
  const r = editProfile(root, {
    actor, proposedBy: proposer,
    message: {
      'fact.edit': `Reword ${pr.payload.id}${pr.payload.part ? `/${pr.payload.part}` : ''}`,
      'fact.new': `Add a fact to ${pr.payload.entity}`,
      'fact.retire': `Retire ${pr.payload.id}`,
      'entity.new': `Add ${pr.payload.label}`,
    }[pr.kind],
    apply: (tx) => {
      if (pr.kind === 'fact.edit') {
        const hit = p._facts.get(pr.payload.id);
        if (!hit) throw new Error(`${pr.payload.id} is no longer in the profile.`);
        if (outcome === 'narrative') narrativeCheck(pr.base?.text || hit.fact.text, wording);
        if (!pr.payload.part) {
          const path = tx.path(pr.payload.id);
          restate(tx, path, hit.fact, wording);
          tx.set(path, 'review_status', 'verified');
        } else {
          const path = tx.path(pr.payload.id, pr.payload.part);
          if (pr.payload.part !== 'ja' && !sameNumbers(wording, hit.fact.text)) throw new Error('A variant must carry the same figures as its fact.');
          tx.set(path, 'text', wording);
          tx.set(path, 'review_status', 'verified');
        }
      } else if (pr.kind === 'fact.new') {
        if (outcome === 'narrative' && hasNumbers(wording)) throw new Error('To keep it as narrative only, write it without figures.');
        const entityId = pr.payload.entity;
        const fact = {
          id: nextFactId(p, entityId, wording), text: wording,
          tags: pr.payload.tags?.length ? pr.payload.tags : undefined, provenance: 'U', priority: pr.payload.priority ?? 2,
          evidence: tx.state(wording), review_status: 'verified',
        };
        if (pr.payload.ja) fact.ja = { text: pr.payload.ja, review_status: 'needs_review' };
        const listKey = ['summary', 'certifications'].includes(entityId) ? entityId : null;
        tx.append(listKey ? [listKey] : [...tx.path(entityId), 'facts'], fact);
      } else if (pr.kind === 'fact.retire') {
        const path = tx.path(pr.payload.id);
        tx.set(path, 'status', 'retired');
        tx.set(path, 'retired_on', today());
        tx.set(path, 'reason', pr.payload.reason);
      } else if (pr.kind === 'entity.new') {
        const key = pr.payload.section === 'projects' ? 'projects' : pr.payload.section === 'education' ? 'education' : 'experiences';
        let eid = slug(pr.payload.label);
        for (let n = 2; p._entities.some((e) => e.id === eid); n++) eid = `${slug(pr.payload.label)}-${n}`;
        tx.append([key], {
          id: eid, label: pr.payload.label, section: pr.payload.section, heading: pr.payload.heading,
          title: pr.payload.title || undefined, dates: pr.payload.dates || undefined, ended: pr.payload.ended,
          tags: pr.payload.tags?.length ? pr.payload.tags : undefined,
          evidence: tx.state([pr.payload.heading, pr.payload.title, pr.payload.dates].filter(Boolean).join(' · ')), facts: [],
        });
      }
    },
  });
  close('accepted', { outcome, commit: r.commit?.sha || null, edited: wording !== pr.payload.text });
  return { ...r, detail: { kind: pr.kind, proposal: id, author: proposer?.name } };
}

function decidePacket(root, actor, id, outcome, reason) {
  const pk = db(root).prepare('SELECT * FROM packets WHERE id = ?').get(id);
  if (!pk || pk.status !== 'in_review') throw new Error('That packet isn\'t waiting for review.');
  if (outcome === 'accept') {
    const m = readManifest(root, pk.manifest);
    if (m?.status !== 'final') throw new Error('Its CV hasn\'t passed the check yet. Open the packet and run the check first.');
    db(root).prepare("UPDATE packets SET status = 'ready', updated_at = ? WHERE id = ?").run(now(), id);
  }
  else {
    if (!reason) throw new Error('Say what needs to change. The person who prepared it will see it.');
    db(root).prepare("UPDATE packets SET status = 'changes_requested', updated_at = ? WHERE id = ?").run(now(), id);
  }
  return { changed: true, detail: { kind: 'packet', packet: id, company: pk.company, role: pk.role, reason } };
}

/** Put a rejected or can't-confirm draft back in the queue. */
export function reopen(root, { actor, key }) {
  assertCan(actor, 'review.decide');
  const k = parseKey(key);
  if (k.type !== 'draft') throw new Error('Only profile drafts can be reopened.');
  const r = editProfile(root, {
    actor, message: `Reopen ${k.id}${k.part ? `/${k.part}` : ''} for review`,
    apply: (tx) => {
      const path = tx.path(k.id, k.what === 'entity' || k.what === 'fact' ? null : k.part);
      for (const field of ['status', 'decided_on', 'decided_by', 'decision_note']) tx.unset(path, field);
      tx.set(path, 'review_status', 'needs_review');
    },
  });
  logActivity(root, { actor, verb: 'review.reopened', subject: key });
  return r;
}

/** Counts for the nav badge and the home page. */
export function summary(root) {
  const q = queue(root);
  const by = (pred) => q.filter(pred).length;
  return {
    total: q.length,
    fromPeople: by((x) => x.source !== 'profile'),
    drafts: by((x) => x.source === 'profile'),
    withNumbers: by((x) => x.hasNumbers),
  };
}
