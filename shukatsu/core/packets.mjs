/**
 * Application packets: everything one application sends, prepared in one place.
 *
 * A packet is a JD (archived verbatim in jds/), a tailored CV (a selection from
 * the master profile, every bullet tagged with its fact), a cover letter, and
 * notes. Anyone with packet rights (the candidate, an editor) can build one;
 * an editor's packet goes to the candidate's review queue, and only the
 * candidate marks it sent. Nothing here submits anything: sending happens
 * outside the app, by the candidate, and `markSent` only records that it did.
 *
 *   drafting -> in_review -> ready -> sent
 *                   \-> changes_requested -> in_review ...
 *   any -> closed (abandoned, kept)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { isLive, loadProfile, quantities, similarity, slug, today } from './facts.mjs';
import { parse as parseJson, json } from './store.mjs';
import { jaHeaderGaps } from './candidate.mjs';
import { render } from './render.mjs';
import { candidates, select } from './select.mjs';
import { finalize, trace, traceProblem } from './trace.mjs';
import { lintWording } from './validate.mjs';
import { readManifest, writeManifest } from './manifests.mjs';
import { addTrackerRow, readTracker, setStatus } from './tracker.mjs';
import { assertCan, can } from './people.mjs';
import { db, logActivity, now, recentActivity } from './store.mjs';
import { readText } from '../audit-materials.mjs';
import { check as charCheck, styleWarnings } from '../char-count.mjs';

const clean = (s, max) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

export const getPacketRow = (root, id) => db(root).prepare(`SELECT pk.*, u.name AS author_name, u.role AS author_role
  FROM packets pk JOIN users u ON u.id = pk.created_by WHERE pk.id = ?`).get(id) || null;

export const listPackets = (root) => db(root).prepare(`SELECT pk.*, u.name AS author_name FROM packets pk
  JOIN users u ON u.id = pk.created_by ORDER BY CASE pk.status WHEN 'in_review' THEN 0 WHEN 'changes_requested' THEN 1 WHEN 'drafting' THEN 2 WHEN 'ready' THEN 3 WHEN 'sent' THEN 4 ELSE 5 END, pk.updated_at DESC`).all();

function touch(root, id, fields = {}) {
  const sets = Object.entries(fields);
  db(root).prepare(`UPDATE packets SET ${[...sets.map(([k]) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`).run(...sets.map(([, v]) => v), now(), id);
}

function assertEditable(actor, pk) {
  assertCan(actor, 'packet.edit');
  if (['sent', 'closed'].includes(pk.status)) throw new Error('This packet is closed. Start a new one to change it.');
  if (pk.status === 'in_review' && actor.role !== 'owner') throw new Error('It\'s waiting for review. Withdraw it from review to keep editing.');
}

/** Archive a JD verbatim under jds/, with a header naming where it came from. */
function saveJd(root, { company, role, url, jdText, actor }) {
  const dir = join(root, 'jds');
  mkdirSync(dir, { recursive: true });
  let name = `${today()}-${slug(company)}-${slug(role)}.md`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${today()}-${slug(company)}-${slug(role)}-${n}.md`;
  const head = [`# ${company} -- ${role}`, '', `**URL:** ${url || '(pasted)'}`, `**Saved:** ${today()} by ${actor.name}`, '', '## Job Description (archived verbatim)', ''];
  writeFileSync(join(dir, name), `${head.join("\n")}\n${jdText.trim()}\n`);
  return `jds/${name}`;
}

/** Start a packet: archive the JD, select facts for the archetype, write the tagged draft. */
export function createPacket(root, { actor, company, role, url = '', jdText = '', archetype, lang = 'en' }) {
  assertCan(actor, 'packet.create');
  company = clean(company, 80);
  role = clean(role, 120);
  if (!company || !role) throw new Error('A packet needs a company and a role.');
  const p = loadProfile(root);
  if (!p.archetypes?.[archetype]) throw new Error('Pick which kind of role this is.');
  const jd = clean(jdText, 60_000);
  const jdPath = jd ? saveJd(root, { company, role, url: clean(url, 500), jdText: jd, actor }) : null;
  if (!['en', 'ja'].includes(lang)) throw new Error('A packet is in English or Japanese.');
  // A Japanese CV can only carry facts whose Japanese wording is confirmed.
  const s = select(p, { archetype, jdText: jd, drop: lang === 'ja' ? [...p._facts.values()].filter((x) => !(x.fact.ja && isLive(x.fact.ja))).map((x) => x.fact.id) : [] });
  const name = `${today()}-${slug(company)}-${slug(role)}${lang === 'ja' ? '-ja' : ''}`;
  let unique = name;
  for (let n = 2; readManifest(root, unique); n++) unique = `${name}-${n}`;
  const draft = join('output', 'tailored', `${unique}-cv.md`);
  mkdirSync(join(root, 'output', 'tailored'), { recursive: true });
  writeFileSync(join(root, draft), render(p, { pick: s.pick, summaryId: s.summaryId, tags: true, lang }).text);
  const t = now();
  const r = db(root).prepare(`INSERT INTO packets (company, role, url, jd_path, archetype, lang, manifest, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(company, role, clean(url, 500) || null, jdPath, archetype, lang, unique, actor.id, t, t);
  const id = Number(r.lastInsertRowid);
  writeManifest(root, unique, {
    schema: 1, created: today(), company, role, num: null, packet: id, archetype, jd: jdPath, lang, summary: s.summaryId,
    selection: s.manifest, output: draft, status: 'draft', final: [],
  });
  logActivity(root, { actor, verb: 'packet.created', subject: `packet:${id}`, detail: { company, role } });
  return id;
}

/** Bullets as the draft has them now, per entity, each with its checks. */
const jaFindings = (text) => styleWarnings(text).map((w) => ({ severity: /co-op|dash|semicolon/.test(w) ? 'error' : 'warn', rule: 'ja-style', message: w }));

function draftBullets(root, p, m) {
  const path = join(root, m.output);
  const text = existsSync(path) ? readText(path) : '';
  const rows = trace(p, text, path, { bullets: true });
  const byEntity = new Map();
  for (const r of rows) {
    const hit = r.id ? p._facts.get(r.id) : null;
    const entity = hit?.entity?.id || '?';
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    const e = hit?.entity;
    // A Japanese line (`/ja`) is a rewording only if it differs from the fact's
    // confirmed Japanese, which is also what it's shown against; trace holds it
    // to that same wording. A variant line is compared with its variant.
    const ja = r.variant === 'ja' ? hit?.fact.ja?.text ?? null : null;
    const declared = ja ?? (r.variant ? (hit?.fact.variants || []).find((v) => v.key === r.variant)?.text : hit?.fact.text);
    byEntity.get(entity).push({
      id: r.id, variant: r.variant, text: r.text, kind: r.kind, score: r.score, original: ja ?? hit?.fact.text ?? null,
      reworded: hit ? r.text !== declared : false,
      problem: traceProblem(r), numberDiff: r.numberDiff,
      lint: m.lang === 'ja' ? jaFindings(r.text) : lintWording(root, r.text, { current: e?.ended === false }),
    });
  }
  return { rows, byEntity };
}

/** Everything the packet page shows. Respects what the viewer may see. */
export function getPacket(root, id, viewer) {
  const pk = getPacketRow(root, id);
  if (!pk) return null;
  const p = loadProfile(root);
  const m = pk.manifest ? readManifest(root, pk.manifest) : null;
  const { byEntity } = m ? draftBullets(root, p, m) : { byEntity: new Map() };
  const sections = p._entities.filter((e) => byEntity.has(e.id)).map((e) => ({
    entity: { id: e.id, label: e.label, heading: e.heading, title: e.title, dates: e.dates, section: e.section },
    bullets: byEntity.get(e.id),
  }));
  const chosen = new Set([...byEntity.values()].flat().map((b) => b.id));
  const jdText = pk.jd_path && existsSync(join(root, pk.jd_path)) ? readFileSync(join(root, pk.jd_path), 'utf-8') : '';
  const ja = pk.lang === 'ja';
  const hasJa = (f) => Boolean(f.ja && isLive(f.ja));
  const pool = candidates(p, pk.archetype, jdText).filter((c) => !chosen.has(c.f.id) && (!ja || hasJa(c.f)))
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ id: c.f.id, entity: c.e.id, entityLabel: c.e.label, text: c.f.text, score: c.score, why: c.why }));
  const budget = p.select?.max_bullets ?? 14;
  // For a Japanese packet: the facts that would make the cut in English but have
  // no confirmed Japanese yet. Each one is a review item, or a wording to propose.
  const missingJa = ja ? candidates(p, pk.archetype, jdText).filter((c) => !hasJa(c.f)).sort((a, b) => b.score - a.score).slice(0, 8)
    .map((c) => ({ id: c.f.id, entityLabel: c.e.label, text: c.f.text, pending: Boolean(c.f.ja?.text), review: c.f.ja?.text ? `draft:ja:${c.f.id}` : null })) : [];
  const answers = (parseJson(pk.answers) || []).map((a) => ({ ...a, check: answerCheck(p, a, pk.lang) }));
  // Why it was sent back: the candidate's last "ask for changes" note (older ones were logged as a rejection).
  const sentBack = pk.status === 'changes_requested'
    ? recentActivity(root, { subject: `packet:${id}`, limit: 40 }).find((a) => ['review.changes', 'review.reject'].includes(a.verb) && a.detail?.kind === 'packet') : null;
  return {
    ...pk, changesNote: sentBack?.detail?.reason || null, jdText, sections, pool, budget, count: chosen.size, missingJa, answers, headerGaps: ja ? jaHeaderGaps(root) : [],
    manifest: m ? { name: m.name, status: m.status, finalized: m.finalized, deliverable: m.deliverable || null, sent_on: m.sent_on || null, gates: m.gates || null, problems: m.problems || null } : null,
    archetypes: Object.entries(p.archetypes || {}).map(([k, v]) => ({ id: k, name: v.name })),
    coverCheck: pk.cover_letter ? coverCheck(p, pk.cover_letter) : [],
    canEdit: viewer ? can(viewer, 'packet.edit') && !['sent', 'closed'].includes(pk.status) && !(pk.status === 'in_review' && viewer.role !== 'owner') : false,
  };
}

/** Rewrite the draft from a pick, keeping every bullet's tag. */
function rewrite(root, pk, mutate) {
  const p = loadProfile(root);
  const m = readManifest(root, pk.manifest);
  const { byEntity } = draftBullets(root, p, m);
  const pick = new Map([...byEntity.entries()].filter(([k]) => k !== '?').map(([k, list]) => [k, list.filter((b) => b.id).map((b) => ({ id: b.id, variant: b.variant, text: b.text }))]));
  mutate(pick, p);
  for (const [k, list] of pick) if (!list.length) pick.delete(k);
  writeFileSync(join(root, m.output), render(p, { pick, summaryId: m.summary, tags: true, lang: m.lang || 'en' }).text);
  m.selection = [...pick.entries()].map(([entity, list]) => ({ entity, facts: list.map((b) => ({ id: b.id, variant: b.variant })) }));
  m.status = 'draft';
  m.final = [];
  m.finalized = null;
  writeManifest(root, m.name, m);
  touch(root, pk.id);
}

/** Reword one bullet. The fact it states is fixed; only the words move. */
export function setBullet(root, { actor, id, factId, text }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertEditable(actor, pk);
  const wording = String(text || '').replace(/\s+/g, ' ').trim();
  if (wording.length < 10) throw new Error('That bullet is too short.');
  rewrite(root, pk, (pick) => {
    for (const list of pick.values()) for (const b of list) if (b.id === factId) b.text = wording;
  });
  logActivity(root, { actor, verb: 'packet.bullet', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role, fact: factId } });
}

/** Add a fact, drop one, or move one up/down within its role. */
export function changeSelection(root, { actor, id, factId, action }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertEditable(actor, pk);
  rewrite(root, pk, (pick, p) => {
    const hit = p._facts.get(factId);
    if (!hit || !hit.entity) throw new Error('No such fact.');
    const eid = hit.entity.id;
    if (action === 'add') {
      if (!isLive(hit.fact)) throw new Error('Only confirmed facts can go on a resume.');
      if (pk.lang === 'ja' && !(hit.fact.ja && isLive(hit.fact.ja))) throw new Error('That fact has no confirmed Japanese yet. Confirm its Japanese in Review first.');
      const total = [...pick.values()].reduce((n, l) => n + l.length, 0);
      if (total >= (p.select?.max_bullets ?? 14)) throw new Error(`The one-page budget is ${p.select?.max_bullets ?? 14} bullets. Drop one first.`);
      const list = pick.get(eid) || [];
      if (!list.some((b) => b.id === factId)) list.push({ id: factId, variant: null });
      pick.set(eid, list);
    } else if (action === 'drop') {
      pick.set(eid, (pick.get(eid) || []).filter((b) => b.id !== factId));
    } else if (action === 'up' || action === 'down') {
      const list = pick.get(eid) || [];
      const i = list.findIndex((b) => b.id === factId);
      const j = action === 'up' ? i - 1 : i + 1;
      if (i !== -1 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    } else throw new Error('Unknown change.');
  });
  logActivity(root, { actor, verb: `packet.${action}`, subject: `packet:${id}`, detail: { company: pk.company, role: pk.role, fact: factId } });
}

/** Run the full gate. The packet can only be marked ready or sent while this passes. */
export function checkPacket(root, { actor, id }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertCan(actor, 'packet.edit');
  const p = loadProfile(root);
  const mPath = join(root, 'data', 'manifests', `${pk.manifest}.json`);
  const r = finalize(p, root, mPath);
  // Written answers are part of the application: one over its limit, or one
  // carrying a figure no confirmed fact states, keeps the packet from passing.
  (parseJson(pk.answers) || []).forEach((a, i) => {
    const c = answerCheck(p, a, pk.lang);
    const label = a.question ? `“${a.question.slice(0, 40)}”` : `answer ${i + 1}`;
    if (c.over) r.problems.push(`${label}: ${c.used} of ${c.limit} ${c.unit}, over the limit`);
    for (const f of c.flags) r.problems.push(`${label}: no confirmed fact states ${f.figures.join(', ')}`);
  });
  if (r.problems.length) r.ok = false;
  const m = readManifest(root, pk.manifest);
  if (!r.ok && m.status === 'final') { m.status = 'draft'; m.finalized = null; }
  m.gates = r.gates.map((g) => ({ name: g.name, ok: g.ok, out: g.ok ? '' : g.out.split('\n').slice(-14).join('\n') }));
  m.problems = r.problems;
  writeManifest(root, pk.manifest, m);
  touch(root, id);
  logActivity(root, { actor, verb: r.ok ? 'packet.passed' : 'packet.failed', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role, problems: r.problems.length } });
  return r;
}

export function setCover(root, { actor, id, text, notes }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertEditable(actor, pk);
  const fields = {};
  if (text !== undefined) fields.cover_letter = clean(text, 8000) || null;
  if (notes !== undefined) fields.notes = clean(notes, 4000) || null;
  touch(root, id, fields);
  logActivity(root, { actor, verb: 'packet.cover', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role } });
}

/**
 * Figures in a cover letter that no live fact states. A letter is prose, so it
 * isn't traced line by line, but a number in it is a claim like any other.
 */
export function coverCheck(p, text) {
  const live = [...p._facts.values()].map((x) => x.fact).filter(isLive);
  const known = new Set(live.flatMap((f) => quantities(f.text)));
  const out = [];
  for (const sentence of String(text).split(/(?<=[.!?。])\s+/u)) {
    const qs = quantities(sentence).filter((q) => !/^(19|20)\d\d$/.test(q));
    const unknown = qs.filter((q) => !known.has(q));
    if (!unknown.length) continue;
    const best = live.map((f) => ({ f, s: similarity(sentence, f.text) })).sort((a, b) => b.s - a.s)[0];
    out.push({ sentence: sentence.trim(), figures: unknown, closest: best && best.s > 0.2 ? best.f.id : null });
  }
  return out;
}

// ---------------------------------------------------------------- written answers

const UNITS = ['chars', 'words'];

/**
 * One form answer checked: length against its limit (characters by grapheme,
 * as Japanese forms count; or words), the 80% fill norm for Japanese ES, the
 * style rules, and any figure no confirmed fact states.
 */
export function answerCheck(p, a, lang) {
  const text = String(a.text || '');
  const flags = coverCheck(p, text);
  if (a.unit === 'words') {
    const words = (text.trim().match(/\S+/g) || []).length;
    const over = a.limit ? words > a.limit : false;
    return { used: words, unit: 'words', limit: a.limit || null, over, underFilled: false, fill: a.limit ? words / a.limit : null, warnings: [], flags };
  }
  const c = charCheck(text, { limit: a.limit || undefined, minFill: lang === 'ja' ? 0.8 : 0 });
  return { used: c.withBreaks, unit: 'chars', limit: c.limit, over: c.over, underFilled: c.underFilled, fill: c.fill ?? null, warnings: c.warnings, flags };
}

/** Replace a packet's written answers (question, limit, unit, text). */
export function setAnswers(root, { actor, id, answers }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertEditable(actor, pk);
  const clean = (Array.isArray(answers) ? answers : []).slice(0, 20).map((a) => ({
    question: String(a.question || '').trim().slice(0, 500),
    limit: Math.max(0, Math.min(10_000, Number(a.limit) || 0)) || null,
    unit: UNITS.includes(a.unit) ? a.unit : 'chars',
    text: String(a.text || '').replace(/\r/g, '').slice(0, 10_000),
  })).filter((a) => a.question || a.text);
  touch(root, id, { answers: json(clean) });
  logActivity(root, { actor, verb: 'packet.answers', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role, n: clean.length } });
  return clean;
}

export function submitForReview(root, { actor, id }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  assertCan(actor, 'packet.edit');
  if (!['drafting', 'changes_requested'].includes(pk.status)) throw new Error('Only a draft can be sent for review.');
  if (actor.role === 'owner') throw new Error('Your own packets don\'t need review. Mark it ready instead.');
  touch(root, id, { status: 'in_review' });
  logActivity(root, { actor, verb: 'packet.submitted', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role } });
}

export function withdrawReview(root, { actor, id }) {
  const pk = getPacketRow(root, id);
  if (!pk || pk.status !== 'in_review') throw new Error('It isn\'t in review.');
  if (pk.created_by !== actor.id && actor.role !== 'owner') throw new Error('Only whoever prepared it can withdraw it.');
  touch(root, id, { status: 'drafting' });
  logActivity(root, { actor, verb: 'packet.withdrawn', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role } });
}

/** The owner's own sign-off. Requires a passing check. */
export function markReady(root, { actor, id }) {
  assertCan(actor, 'review.decide');
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  const m = readManifest(root, pk.manifest);
  if (m?.status !== 'final') throw new Error('Run the check first. It has to pass before the packet is ready.');
  touch(root, id, { status: 'ready' });
  logActivity(root, { actor, verb: 'packet.ready', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role } });
}

/**
 * Record that the candidate submitted it (outside this app). Marks the
 * manifest sent and moves the tracker: an existing row goes to Applied, or a
 * new row is added the canonical way.
 */
export function markSent(root, { actor, id, on = today() }) {
  assertCan(actor, 'packet.send');
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  const m = readManifest(root, pk.manifest);
  if (m?.status !== 'final') throw new Error('The CV hasn\'t passed its check. Run it before marking this sent.');
  let num = pk.tracker_num;
  if (!num) {
    const match = readTracker(root).rows.find((r) => r.company.toLowerCase() === pk.company.toLowerCase() && r.role.toLowerCase() === pk.role.toLowerCase());
    num = match?.num ?? null;
  }
  let tracker;
  if (num) tracker = setStatus(root, num, 'Applied', `packet #${id}`);
  else {
    tracker = addTrackerRow(root, { company: pk.company, role: pk.role, status: 'Applied', notes: `packet #${id}`, url: pk.url || '' });
    num = tracker.num ?? null;
  }
  // Nothing is marked sent unless the tracker really moved, so a failure can be retried.
  if (!tracker.ok) throw new Error(`The tracker couldn't be updated, so nothing was marked sent: ${tracker.out}`);
  m.sent_on = on;
  if (num) m.num = String(num);
  writeManifest(root, pk.manifest, m);
  touch(root, id, { status: 'sent', sent_on: on, tracker_num: num });
  logActivity(root, { actor, verb: 'packet.sent', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role, num, tracker: tracker.ok } });
  return { num, tracker };
}

export function closePacket(root, { actor, id }) {
  const pk = getPacketRow(root, id);
  if (!pk) throw new Error('No such packet.');
  if (pk.created_by !== actor.id) assertCan(actor, 'review.decide');
  touch(root, id, { status: 'closed' });
  logActivity(root, { actor, verb: 'packet.closed', subject: `packet:${id}`, detail: { company: pk.company, role: pk.role } });
}

export function packetPaths(root, pk) {
  const m = pk.manifest ? readManifest(root, pk.manifest) : null;
  return { draft: m?.output ? join(root, m.output) : null, deliverable: m?.deliverable ? join(root, m.deliverable) : null, rel: m ? relative(root, join(root, m.output)) : null };
}
