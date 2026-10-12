/**
 * Proposals: a change someone wants made, waiting for the candidate.
 *
 * Mentors never write the truth files. Everything they want changed becomes a
 * proposal, and only the owner's decision applies it (core/review.mjs). The
 * owner's own edits go through the same path (`propose` then `accept` in one
 * call), so every change has one history and one audit trail.
 *
 * Kinds and payloads:
 *   fact.edit    { id, part: null | 'ja' | <variant key>, text }
 *   fact.new     { entity, text, tags?, priority?, ja? }
 *   fact.retire  { id, reason }
 *   entity.new   { section, label, heading, title?, dates?, ended?, tags? }
 *   posting      { url, company?, role?, note? }   -> data/pipeline.md
 */

import { db, json, logActivity, now, parse } from './store.mjs';
import { assertCan } from './people.mjs';
import { BULLET_SECTIONS, factText, loadProfile } from './facts.mjs';

export const KINDS = ['fact.edit', 'fact.new', 'fact.retire', 'entity.new', 'posting'];
const SECTIONS = ['work', 'projects', 'volunteering', 'education'];

const clean = (s, max = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function wordingOf(p, id, part) {
  const hit = p._facts.get(id);
  if (!hit) throw new Error(`No fact "${id}".`);
  const f = hit.fact;
  if (part === 'ja') return f.ja?.text ?? '';
  if (part) {
    const v = (f.variants || []).find((x) => x.key === part);
    if (!v) throw new Error(`${id} has no variant "${part}".`);
    return v.text;
  }
  return f.text;
}

/** Validate and normalize a payload; returns { payload, target, base }. */
export function normalize(root, kind, raw) {
  const p = loadProfile(root);
  if (kind === 'fact.edit') {
    const id = clean(raw.id, 80);
    const part = raw.part ? clean(raw.part, 40) : null;
    const text = clean(raw.text, 400);
    if (!text) throw new Error('The new wording is empty.');
    const before = wordingOf(p, id, part);
    if (before === text) throw new Error('That wording is the same as the current one.');
    return { payload: { id, part, text }, target: id, base: { text: before } };
  }
  if (kind === 'fact.new') {
    const entity = clean(raw.entity, 80);
    const e = p._entities.find((x) => x.id === entity) || (['summary', 'certifications'].includes(entity) ? { id: entity, section: entity } : null);
    if (!e) throw new Error(`No role, project, or school "${entity}".`);
    const text = clean(raw.text, 400);
    if (text.length < 12) throw new Error('Describe the achievement in at least a sentence.');
    const tags = (Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(/[,\s]+/)).map((t) => clean(t, 30)).filter((t) => (p.tag_vocabulary || []).includes(t));
    const priority = [1, 2, 3].includes(Number(raw.priority)) ? Number(raw.priority) : 2;
    const ja = clean(raw.ja, 400) || null;
    return { payload: { entity, text, tags, priority, ja }, target: entity, base: null };
  }
  if (kind === 'fact.retire') {
    const id = clean(raw.id, 80);
    if (!p._facts.has(id)) throw new Error(`No fact "${id}".`);
    const reason = clean(raw.reason, 300);
    if (!reason) throw new Error('Say why it should be retired.');
    return { payload: { id, reason }, target: id, base: { text: factText(p._facts.get(id).fact) } };
  }
  if (kind === 'entity.new') {
    const section = SECTIONS.includes(raw.section) ? raw.section : null;
    if (!section) throw new Error('Pick work, projects, volunteering, or education.');
    const label = clean(raw.label, 80);
    if (!label) throw new Error('It needs a name.');
    const heading = clean(raw.heading, 120) || label;
    return {
      payload: {
        section, label, heading, title: clean(raw.title, 120) || null, dates: clean(raw.dates, 80) || null,
        ended: raw.ended === undefined ? true : Boolean(raw.ended && raw.ended !== 'false'),
        tags: (Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(/[,\s]+/)).filter((t) => (p.tag_vocabulary || []).includes(t)),
      },
      target: null, base: null,
    };
  }
  if (kind === 'posting') {
    let url;
    try { url = new URL(String(raw.url || '').trim()); } catch { throw new Error('That isn\'t a link to a posting.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Postings are http or https links.');
    return {
      payload: { url: url.toString(), company: clean(raw.company, 80), role: clean(raw.role, 120), note: clean(raw.note, 300) },
      target: url.toString(), base: null,
    };
  }
  throw new Error(`Unknown proposal kind "${kind}".`);
}

export function propose(root, { actor, kind, payload, note = '' }) {
  assertCan(actor, kind === 'posting' ? 'suggest.posting' : 'propose.profile');
  const n = normalize(root, kind, payload);
  if (kind === 'posting') {
    const dupe = db(root).prepare("SELECT id FROM proposals WHERE kind = 'posting' AND target = ? AND status = 'open'").get(n.target);
    if (dupe) throw new Error('Someone already suggested that posting.');
  }
  const t = now();
  const r = db(root).prepare(`INSERT INTO proposals (kind, target, payload, base, note, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(kind, n.target, json(n.payload), json(n.base), clean(note, 1000) || null, actor.id, t, t);
  const id = Number(r.lastInsertRowid);
  logActivity(root, { actor, verb: 'proposal.created', subject: `proposal:${id}`, detail: { kind, target: n.target, text: n.payload.text || n.payload.label || n.payload.url } });
  return id;
}

const ROW = `SELECT pr.*, a.name AS author_name, a.role AS author_role, d.name AS decided_by_name
  FROM proposals pr JOIN users a ON a.id = pr.author_id LEFT JOIN users d ON d.id = pr.decided_by`;
const hydrate = (r) => r && ({ ...r, payload: parse(r.payload), base: parse(r.base), result: parse(r.result) });

export const getProposal = (root, id) => hydrate(db(root).prepare(`${ROW} WHERE pr.id = ?`).get(id));
export const openProposals = (root) => db(root).prepare(`${ROW} WHERE pr.status = 'open' ORDER BY pr.created_at`).all().map(hydrate);
export const decidedProposals = (root, limit = 50) => db(root).prepare(`${ROW} WHERE pr.status != 'open' ORDER BY pr.updated_at DESC LIMIT ?`).all(limit).map(hydrate);
export const proposalsBy = (root, userId) => db(root).prepare(`${ROW} WHERE pr.author_id = ? ORDER BY pr.created_at DESC LIMIT 100`).all(userId).map(hydrate);

export function withdraw(root, { actor, id }) {
  const pr = getProposal(root, id);
  if (!pr || pr.status !== 'open') throw new Error('That proposal is no longer open.');
  if (pr.author_id !== actor.id) throw new Error('Only its author can withdraw a proposal.');
  db(root).prepare("UPDATE proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(now(), id);
  logActivity(root, { actor, verb: 'proposal.withdrawn', subject: `proposal:${id}` });
}

/** Let an author revise their open proposal (the wording, or the note). */
export function revise(root, { actor, id, payload, note }) {
  const pr = getProposal(root, id);
  if (!pr || pr.status !== 'open') throw new Error('That proposal is no longer open.');
  if (pr.author_id !== actor.id) throw new Error('Only its author can revise a proposal.');
  const n = normalize(root, pr.kind, { ...pr.payload, ...payload });
  db(root).prepare('UPDATE proposals SET payload = ?, base = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(json(n.payload), json(n.base ?? pr.base), note === undefined ? pr.note : clean(note, 1000) || null, now(), id);
  logActivity(root, { actor, verb: 'proposal.revised', subject: `proposal:${id}` });
}

/** Stale when the wording it was written against has changed since. */
export function isStale(root, pr) {
  if (pr.kind !== 'fact.edit' || !pr.base) return false;
  try { return wordingOf(loadProfile(root), pr.payload.id, pr.payload.part) !== pr.base.text; } catch { return true; }
}

export { BULLET_SECTIONS };
