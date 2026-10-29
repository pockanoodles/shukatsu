/**
 * Asks: the candidate asking one person to look at one thing.
 *
 * The review queue is where helpers bring what they found. An ask runs the
 * other way: the candidate picks one item and one person ("Mom, would you
 * check the keigo in this answer?"), the person gets a nudge and a page with
 * only that item on it, and their answer comes back. Two kinds of item:
 *
 *   packet:{id}#a{n}   the n-th written answer on a packet (ES, form question)
 *   fact:{id}/ja       a fact's Japanese wording
 *
 * An answer never writes anything true by itself. For a fact, the reply is a
 * fact.edit proposal from that person, so it goes through the review queue and
 * the candidate's stamp like any other, and the ask closes when that proposal
 * is decided. For a packet answer, the reply waits on the ask until the
 * candidate uses it (written into the packet) or doesn't. Either way the
 * person sees what happened, with the candidate's note and the wording that
 * was kept. "Looks fine as it is" closes the ask straight away.
 *
 *   open -> answered -> closed (used | not_used)      or      open -> closed (fine)
 *   open | answered -> cancelled                       (the candidate withdrew it)
 *
 * Nothing here sends anything. The LINE connector's minute tick reads
 * pendingNudges() and tells the person, with a link and no content (see
 * connectors/line). settle() is the same tick closing asks whose proposal
 * the candidate decided.
 */

import { db, json, logActivity, now, parse, tx } from './store.mjs';
import { assertCan, can, getUser } from './people.mjs';
import { loadProfile } from './facts.mjs';
import { getPacketRow, setAnswers } from './packets.mjs';
import { getProposal, propose, revise } from './proposals.mjs';

export const SUBJECT = /^(packet:(\d+)#a(\d+)|fact:([a-z0-9.\-]+)\/ja)$/;
export const OUTCOMES = ['used', 'not_used', 'fine'];

const clean = (s, max) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

/** What a subject points at: { kind: 'answer', packet, n } or { kind: 'ja', fact }. */
export function parseSubject(subject) {
  const m = SUBJECT.exec(String(subject || ''));
  if (!m) throw new Error('An ask is about one written answer (packet:{id}#a{n}) or one fact\'s Japanese (fact:{id}/ja).');
  return m[2] ? { kind: 'answer', packet: Number(m[2]), n: Number(m[3]) } : { kind: 'ja', fact: m[4] };
}

/** The item as it stands now, so the person sees it and a later change can be noticed. */
function snapshot(root, s) {
  if (s.kind === 'answer') {
    const pk = getPacketRow(root, s.packet);
    if (!pk) throw new Error('No such packet.');
    if (['sent', 'closed'].includes(pk.status)) throw new Error('That packet is closed.');
    const a = (parse(pk.answers) || [])[s.n - 1];
    if (!a) throw new Error(`That packet has no answer ${s.n}.`);
    return { company: pk.company, role: pk.role, lang: pk.lang, question: a.question, limit: a.limit, unit: a.unit, text: a.text };
  }
  const hit = loadProfile(root)._facts.get(s.fact);
  if (!hit) throw new Error(`No fact "${s.fact}".`);
  return { heading: hit.entity?.heading || null, en: hit.fact.text, text: hit.fact.ja?.text || '' };
}

/** Whether this person can be asked about this kind of item: a helper who sees the work, and for a fact, one who may propose. */
export function canBeAsked(user, kind) {
  if (!user || user.disabled_at || user.kind !== 'person' || user.role === 'owner') return false;
  return can(user, 'view.review') && (kind !== 'ja' || can(user, 'propose.profile'));
}

const ROW = `SELECT k.*, f.name AS asked_by_name, o.name AS asked_of_name, o.lang AS asked_of_lang
  FROM asks k JOIN users f ON f.id = k.asked_by JOIN users o ON o.id = k.asked_of`;
const hydrate = (r) => r && ({ ...r, base: parse(r.base), result: parse(r.result) });

export const getAskRow = (root, id) => hydrate(db(root).prepare(`${ROW} WHERE k.id = ?`).get(id));

/**
 * An ask as a page shows it: the row, what it is about, and for a fact ask
 * the state its proposal is in. An answered fact ask whose proposal was
 * decided reads as closed here before settle() records it.
 */
function view(root, k) {
  const s = parseSubject(k.subject);
  const pr = k.proposal_id ? getProposal(root, k.proposal_id) : null;
  const out = { ...k, item: s.kind, proposal: pr ? { id: pr.id, status: pr.status, text: pr.payload.text } : null };
  const d = pr && k.status === 'answered' ? decidedAs(root, s, pr) : null;
  return d ? { ...out, status: 'closed', outcome: d.outcome, close_note: d.note, result: d.result, closed_at: pr.decided_at } : out;
}

/** How a decided proposal closes its ask, or null while it is open. */
function decidedAs(root, s, pr) {
  if (pr.status === 'accepted') {
    const f = loadProfile(root)._facts.get(s.fact)?.fact;
    return { outcome: 'used', note: pr.decision_note, result: { text: f?.ja?.text ?? pr.payload.text, edited: Boolean(pr.result?.edited) } };
  }
  if (pr.status === 'rejected') return { outcome: 'not_used', note: pr.decision_note, result: null };
  return null;
}

/** Every ask, newest first: all of them for the candidate (and agents), only their own for anyone else. */
export function listAsks(root, viewer, { status = null, limit = 100 } = {}) {
  const mine = viewer.role !== 'owner' && viewer.kind !== 'agent';
  const rows = db(root).prepare(`${ROW} ${mine ? 'WHERE k.asked_of = ?' : ''} ORDER BY k.created_at DESC LIMIT ?`).all(...(mine ? [viewer.id] : []), limit);
  const all = rows.map((r) => view(root, hydrate(r)));
  return status ? all.filter((k) => k.status === status) : all;
}

export function getAsk(root, id, viewer) {
  const k = getAskRow(root, id);
  if (!k) throw new Error('No such ask.');
  if (viewer.role !== 'owner' && viewer.kind !== 'agent' && k.asked_of !== viewer.id) throw new Error('That ask is for someone else.');
  return view(root, k);
}

/** Open asks about one subject, so the page that shows it can say who was asked. */
export const asksAbout = (root, subject) => db(root).prepare(`${ROW} WHERE k.subject = ? AND k.status IN ('open', 'answered') ORDER BY k.created_at`).all(subject).map(hydrate);

// ---------------------------------------------------------------- the candidate

export function createAsk(root, { actor, to, subject, note = '' }) {
  assertCan(actor, 'ask.create');
  const s = parseSubject(subject);
  const person = getUser(root, Number(to));
  if (!canBeAsked(person, s.kind)) {
    throw new Error(s.kind === 'ja' ? 'Ask an editor: only they can suggest wording for the record.' : 'Ask someone helping you who can see your applications.');
  }
  const open = db(root).prepare("SELECT id FROM asks WHERE subject = ? AND asked_of = ? AND status IN ('open', 'answered')").get(subject, person.id);
  if (open) throw new Error(`${person.name} already has this one.`);
  const base = snapshot(root, s);
  const t = now();
  const r = db(root).prepare(`INSERT INTO asks (subject, asked_by, asked_of, note, base, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(subject, actor.id, person.id, clean(note, 1000) || null, json(base), t, t);
  const id = Number(r.lastInsertRowid);
  logActivity(root, { actor, verb: 'ask.created', subject: `ask:${id}`, detail: { to: person.name, about: subject } });
  return id;
}

/**
 * The candidate's answer to an answer. Only a packet answer is closed here:
 * using it writes the person's text into that answer on the packet. A fact
 * ask closes when its proposal is decided in the review queue.
 */
export function closeAsk(root, { actor, id, outcome, note = '' }) {
  assertCan(actor, 'ask.create');
  const k = getAskRow(root, id);
  if (!k || k.status !== 'answered') throw new Error('Only an answered ask can be closed.');
  const s = parseSubject(k.subject);
  if (s.kind === 'ja') throw new Error('Decide the suggested wording in Review. The ask closes with it.');
  if (!['used', 'not_used'].includes(outcome)) throw new Error('Either use the answer or don\'t.');
  tx(root, () => {
    let result = null;
    if (outcome === 'used') {
      const pk = getPacketRow(root, s.packet);
      if (!pk) throw new Error('That packet is gone.');
      const answers = parse(pk.answers) || [];
      // Found by its question, so an answer moved up or down the form still matches; by position only if its question was renamed.
      let i = answers.findIndex((a) => a.question === k.base.question);
      if (i < 0 && answers[s.n - 1]) i = s.n - 1;
      if (i < 0) throw new Error('That question is no longer on the packet.');
      setAnswers(root, { actor, id: s.packet, answers: answers.map((a, j) => (j === i ? { ...a, text: k.reply } : a)) });
      result = { text: k.reply, replaced: answers[i].text };
    }
    db(root).prepare("UPDATE asks SET status = 'closed', outcome = ?, close_note = ?, result = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(outcome, clean(note, 1000) || null, json(result), now(), now(), id);
  });
  logActivity(root, { actor, verb: 'ask.closed', subject: `ask:${id}`, detail: { outcome, to: k.asked_of_name, about: k.subject } });
}

export function cancelAsk(root, { actor, id }) {
  assertCan(actor, 'ask.create');
  const k = getAskRow(root, id);
  if (!k || !['open', 'answered'].includes(k.status)) throw new Error('That ask is already closed.');
  db(root).prepare("UPDATE asks SET status = 'cancelled', closed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  logActivity(root, { actor, verb: 'ask.cancelled', subject: `ask:${id}`, detail: { to: k.asked_of_name, about: k.subject } });
}

// ---------------------------------------------------------------- the person asked

/**
 * Answer an ask: new wording, or `fine` for "looks right as it is". Until the
 * candidate acts on it the person can answer again, which replaces the reply
 * (or revises their proposal).
 */
export function replyAsk(root, { actor, id, text = '', note = '', fine = false }) {
  const k = getAskRow(root, id);
  if (!k) throw new Error('No such ask.');
  if (k.asked_of !== actor.id) throw new Error('That ask is for someone else.');
  const pr = k.proposal_id ? getProposal(root, k.proposal_id) : null;
  if (!['open', 'answered'].includes(k.status) || (pr && pr.status !== 'open' && pr.status !== 'withdrawn')) throw new Error('That ask is already closed.');
  const s = parseSubject(k.subject);
  const body = s.kind === 'ja' ? clean(text, 400).replace(/\s+/g, ' ') : clean(text, 10_000);
  const said = clean(note, 1000) || null;
  const same = fine || !body || body === snapshot(root, s).text;
  const t = now();
  if (same) {
    if (pr?.status === 'open') db(root).prepare("UPDATE proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(t, pr.id);
    db(root).prepare("UPDATE asks SET status = 'closed', outcome = 'fine', reply = NULL, reply_note = ?, proposal_id = NULL, answered_at = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(said, t, t, t, id);
    logActivity(root, { actor, verb: 'ask.answered', subject: `ask:${id}`, detail: { fine: true, about: k.subject } });
    return { status: 'closed', outcome: 'fine' };
  }
  let proposal = null;
  if (s.kind === 'ja') {
    if (pr?.status === 'open') { revise(root, { actor, id: pr.id, payload: { text: body }, note: said ?? undefined }); proposal = pr.id; }
    else proposal = propose(root, { actor, kind: 'fact.edit', payload: { id: s.fact, part: 'ja', text: body }, note: said || '' });
  }
  db(root).prepare("UPDATE asks SET status = 'answered', reply = ?, reply_note = ?, proposal_id = ?, answered_at = ?, updated_at = ? WHERE id = ?")
    .run(s.kind === 'ja' ? null : body, said, proposal, t, t, id);
  logActivity(root, { actor, verb: 'ask.answered', subject: `ask:${id}`, detail: { about: k.subject, ...(proposal ? { proposal } : {}) } });
  return { status: 'answered', proposal };
}

// ---------------------------------------------------------------- the minute tick

/** Record the close of every answered fact ask whose proposal was decided; a withdrawn one goes back to open. */
export function settle(root) {
  const rows = db(root).prepare(`${ROW} WHERE k.status = 'answered' AND k.proposal_id IS NOT NULL`).all().map(hydrate);
  let n = 0;
  for (const k of rows) {
    const pr = getProposal(root, k.proposal_id);
    if (!pr) continue;
    if (pr.status === 'withdrawn') {
      db(root).prepare("UPDATE asks SET status = 'open', proposal_id = NULL, updated_at = ? WHERE id = ?").run(now(), k.id);
      continue;
    }
    const d = decidedAs(root, parseSubject(k.subject), pr);
    if (!d) continue;
    db(root).prepare("UPDATE asks SET status = 'closed', outcome = ?, close_note = ?, result = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .run(d.outcome, d.note || null, json(d.result), pr.decided_at || now(), now(), k.id);
    n++;
  }
  return n;
}

/**
 * What the person should hear about: a new ask, or one the candidate closed.
 * A "fine" close was their own doing and a cancel needs no message.
 */
export function pendingNudges(root) {
  return db(root).prepare(`${ROW} WHERE (k.nudged_at IS NULL AND k.status IN ('open', 'answered'))
      OR (k.closed_nudged_at IS NULL AND k.status = 'closed' AND k.outcome IN ('used', 'not_used'))
    ORDER BY k.id`).all().map((r) => ({ ...hydrate(r), event: r.status === 'closed' ? 'closed' : 'created' }));
}

/** Mark a nudge handled ('sent', 'failed', or 'unlinked' when the person has no chat account linked); it is tried once. */
export function markNudged(root, id, event, result) {
  const col = event === 'closed' ? 'closed_nudged_at' : 'nudged_at';
  db(root).prepare(`UPDATE asks SET ${col} = ?, nudge = ? WHERE id = ?`).run(now(), result, id);
}
