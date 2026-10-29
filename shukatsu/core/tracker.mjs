/**
 * The application tracker and the pipeline inbox, read through upstream's own
 * parsers and written only through upstream's canonical CLIs:
 *
 *   status change  set-status.mjs --row N (locked, validated, atomic, logged)
 *   new row        batch/tracker-additions/*.tsv + merge-tracker.mjs
 *   Target, Due    setTargetDue, under the same lock (upstream has no field for them)
 *   inbox item     data/pipeline.md, appended under "## Pending"
 *
 * The tracker is never edited by hand here: those CLIs hold the lock and the
 * states contract (templates/states.yml), and the status log depends on them.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import * as yaml from 'js-yaml';
import { resolveTrackerPath, resolveTrackerPathForWrite } from '../../path-resolver.mjs';
import { parseTrackerRow, resolveColumns } from '../../tracker-parse.mjs';
import { acquireTrackerLock, cell, trackerLockDirFor, writeFileAtomic } from '../../tracker-utils.mjs';
import { ENGINE } from './trace.mjs';

export function readTracker(root) {
  const path = resolveTrackerPath(root);
  if (!existsSync(path)) return { path, rows: [] };
  const lines = readFileSync(path, 'utf-8').split('\n');
  const colmap = resolveColumns(lines);
  const rows = lines.map((l) => parseTrackerRow(l, colmap)).filter(Boolean).map(({ raw: _raw, ...r }) => r);
  return { path, rows };
}

/** num -> {company, role, status}, for the manifest views. */
export function trackerRows(root) {
  return new Map(readTracker(root).rows.map((r) => [String(r.num), { company: r.company, role: r.role, status: r.status }]));
}

export function canonicalStates() {
  const doc = yaml.load(readFileSync(join(ENGINE, 'templates', 'states.yml'), 'utf-8'));
  return doc.states.map((s) => ({ id: s.id, label: s.label, terminal: Boolean(s.terminal), description: s.description }));
}

/** Status history from data/status-log.tsv: num -> [{date, from, to, source, note}]. */
export function statusLog(root) {
  const path = join(root, 'data', 'status-log.tsv');
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const [num, date, from, to, source, note] = line.split('\t');
    if (!/^\d+$/.test(num || '')) continue;
    if (!out.has(num)) out.set(num, []);
    out.get(num).push({ date, from, to, source, note: note || '' });
  }
  return out;
}

/** Run an upstream CLI against this data root (its own lock, validation, and log). */
export function runEngine(script, args, root) {
  const r = spawnSync(process.execPath, [join(ENGINE, script), ...args], {
    cwd: ENGINE, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_DATA_DIR: root },
  });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

export function setStatus(root, num, state, note = '') {
  const args = ['--row', String(num), state, '--json'];
  if (note) args.push('--note', note);
  return runEngine('set-status.mjs', args, root);
}

const tsvCell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// The empty tracker, exactly as AGENTS.md's onboarding (step 4) creates it.
const TRACKER_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

/**
 * merge-tracker.mjs merges into an existing tracker and won't create one (it
 * exits 0 with "nothing to merge into"), so a first application needs the file
 * made first, at the canonical write path.
 */
export function ensureTracker(root) {
  if (existsSync(resolveTrackerPath(root))) return false;
  const path = resolveTrackerPathForWrite(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, TRACKER_HEADER);
  return true;
}

/**
 * Add a tracker row the canonical way: one headed TSV in
 * batch/tracker-additions/, then merge-tracker.mjs. `num` comes from
 * reserve-report-num.mjs so it can never collide with a parallel evaluator.
 * Success means the row is in the tracker afterwards, not that the merge
 * exited 0. A company+role already tracked keeps its own number, whether the
 * merge updates it or skips it (an unscored add never overwrites a score), so
 * that is the number returned.
 */
export function addTrackerRow(root, { company, role, status = 'Evaluated', score = 'N/A', notes = '', url = '' }) {
  ensureTracker(root);
  const reserved = runEngine('reserve-report-num.mjs', ['--count', '1'], root);
  const num = (reserved.out.match(/\b(\d{3,})\b/) || [])[1];
  if (!reserved.ok || !num) return { ok: false, out: `could not reserve a number: ${reserved.out}` };
  const dir = join(root, 'batch', 'tracker-additions');
  mkdirSync(dir, { recursive: true });
  const slug = String(company).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  const header = ['num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes', 'url'];
  const row = [num, new Date().toISOString().slice(0, 10), company, role, status, score, '❌', '—', notes, url].map(tsvCell);
  const before = new Map(readTracker(root).rows.map((r) => [r.num, JSON.stringify(r)]));
  const file = `${num}-${slug}.tsv`;
  writeFileSync(join(dir, file), `${header.join('\t')}\n${row.join('\t')}\n`);
  const merged = runEngine('merge-tracker.mjs', [], root);
  runEngine('reserve-report-num.mjs', ['--release', num], root);
  const after = readTracker(root).rows;
  const skippedAs = Number((merged.out.match(new RegExp(`Skipping ${file.replace(/\./g, '\\.')}: re-eval of #(\\d+) `)) || [])[1]);
  const landed = after.find((r) => r.num === Number(num))
    || after.find((r) => before.has(r.num) && before.get(r.num) !== JSON.stringify(r))
    || after.find((r) => r.num === skippedAs);
  return { ok: merged.ok && !!landed, num: landed?.num ?? null, out: landed ? merged.out : `the row didn't reach the tracker: ${merged.out.split('\n').slice(-3).join(' ')}` };
}

// ---------------------------------------------------------------- target and due

/**
 * Target and Due are this tracker's own columns. Upstream's alias table has no
 * field for them, so merge-tracker writes `—` into both on a new row and keeps
 * whatever an existing row holds when it rebuilds it. They are filled here,
 * after the row exists:
 *
 *   Target  a key of `outcomes:` in data/targets.yml: what the application is for
 *   Due     its deadline, YYYY-MM-DD, optionally followed by a short note
 *
 * `—` clears either one.
 */
const CLEARED = new Set(['—', '-']);

/** The outcome keys in data/targets.yml; none when the file is missing or empty. */
export function outcomeKeys(root) {
  const file = join(root, 'data', 'targets.yml');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf-8');
  // js-yaml 5 throws on a document with nothing in it; an empty file has no outcomes.
  if (!text.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'))) return [];
  const outcomes = yaml.load(text)?.outcomes;
  return outcomes && typeof outcomes === 'object' && !Array.isArray(outcomes) ? Object.keys(outcomes) : [];
}

function realDate(text) {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?=\s|$)/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The table's header row and its labels, lowercased (the first cell, before the opening pipe, is ''). */
function headerOf(lines) {
  const h = lines.findIndex((l) => l.trim().startsWith('|'));
  return { h, labels: h < 0 ? [] : cellsOf(lines[h]).map((c) => c.toLowerCase()) };
}

// Split like parseTrackerRow does: parts[0] is the empty cell before the opening pipe.
const cellsOf = (line) => line.trimEnd().replace(/\|$/, '').split('|').map((c) => c.trim());
const LABEL = { target: 'Target', due: 'Due' };

/**
 * The cells to write for `{ target, due }`, checked against data/targets.yml
 * and the tracker's columns (the stock layout ensureTracker makes when there
 * is none yet has neither). Undefined leaves a cell as it is. Throws before
 * anything is touched, so a caller can check first and only then add the row.
 */
export function targetDueCells(root, { target, due } = {}) {
  const want = {};
  if (target !== undefined) {
    const t = cell(target);
    const keys = outcomeKeys(root);
    if (CLEARED.has(t)) want.target = '—';
    else if (keys.includes(t)) want.target = t;
    else throw new Error(`"${t}" is not a Target. Targets are the outcomes in data/targets.yml: ${keys.join(', ') || 'none yet'}.`);
  }
  if (due !== undefined) {
    const d = cell(due);
    if (CLEARED.has(d)) want.due = '—';
    else if (realDate(d)) want.due = d;
    else throw new Error(`"${d}" is not a Due date. Write it as YYYY-MM-DD, optionally followed by a short note.`);
  }
  if (!Object.keys(want).length) throw new Error('Give a Target, a Due date, or both.');
  const path = resolveTrackerPath(root);
  const { labels } = headerOf((existsSync(path) ? readFileSync(path, 'utf-8') : TRACKER_HEADER).split('\n'));
  for (const k of Object.keys(want)) if (!labels.includes(k)) throw new Error(`The tracker has no ${LABEL[k]} column.`);
  return want;
}

/**
 * Write row `num`'s Target and/or Due, under the lock merge-tracker.mjs and
 * set-status.mjs take, as one atomic replace. The row is found the way
 * upstream reads it (resolveColumns, so `#` needn't come first); one whose
 * cells don't line up with the header (a stray `|` in a cell) is refused
 * rather than shifted.
 */
export async function setTargetDue(root, num, values) {
  const want = targetDueCells(root, values);
  const path = resolveTrackerPath(root);
  if (!existsSync(path)) throw new Error('There is no tracker yet.');
  const lock = await acquireTrackerLock(trackerLockDirFor(path), { tracker: path });
  try {
    const lines = readFileSync(path, 'utf-8').split('\n');
    const { h, labels } = headerOf(lines);
    const col = { target: labels.indexOf('target'), due: labels.indexOf('due') };
    for (const k of Object.keys(want)) if (col[k] < 0) throw new Error(`The tracker has no ${LABEL[k]} column.`);
    const colmap = resolveColumns(lines);
    const i = lines.findIndex((l, j) => j > h && parseTrackerRow(l, colmap)?.num === num);
    if (i < 0) throw new Error(`The tracker has no row ${num}.`);
    const cells = cellsOf(lines[i]);
    if (cells.length !== labels.length) throw new Error(`Row ${num} has ${cells.length - 1} cells but the header has ${labels.length - 1}; fix the row by hand first.`);
    let changed = false;
    for (const [k, v] of Object.entries(want)) {
      if (cells[col[k]] !== v) { cells[col[k]] = v; changed = true; }
    }
    if (changed) {
      lines[i] = `| ${cells.slice(1).join(' | ')} |`;
      writeFileAtomic(path, lines.join('\n'), { mode: statSync(path).mode & 0o777 });
    }
    return { num, target: col.target < 0 ? null : cells[col.target], due: col.due < 0 ? null : cells[col.due], changed };
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------- pipeline inbox

const PIPELINE = (root) => join(root, 'data', 'pipeline.md');

/** Pending items: `- [ ] url | company | role | location | extra...` */
export function readPipeline(root) {
  const path = PIPELINE(root);
  if (!existsSync(path)) return [];
  const items = [];
  let section = '';
  readFileSync(path, 'utf-8').split('\n').forEach((line, i) => {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { section = h[1].trim(); return; }
    const m = line.match(/^- \[( |x|!)\]\s+(.*)$/i);
    if (!m) return;
    const parts = m[2].split(' | ').map((s) => s.trim());
    const url = (parts[0].match(/(https?:\/\/\S+|local:\S+)/) || [])[1] || parts[0];
    // After url | company | role, a `key: value` cell is metadata (posted:,
    // note:) wherever it sits; the first bare cell is the location.
    const rest = parts.slice(3);
    const meta = Object.fromEntries(rest.map((c) => c.match(/^([a-z][a-z-]*):\s*(.*)$/i)).filter(Boolean).map((x) => [x[1].toLowerCase(), x[2]]));
    items.push({
      line: i + 1, section, state: m[1] === ' ' ? 'pending' : m[1] === '!' ? 'blocked' : 'done',
      url, company: parts[1] || '', role: parts[2] || '',
      location: rest.find((c) => !/^[a-z][a-z-]*:\s/i.test(c)) || '', posted: meta.posted || '', note: meta.note || '',
      extra: rest.join(' | '),
    });
  });
  return items;
}

/**
 * Append one inbox item under "## Pending" (created if missing). Returns false for a duplicate URL.
 * `blocked` writes it as `- [!]`, the pipeline's mark for an item that can't go on until the
 * candidate supplies something (a posting whose text shukatsu may not copy).
 */
export function appendPipeline(root, { url, company = '', role = '', location = '', note = '', blocked = false }) {
  const path = PIPELINE(root);
  const text = existsSync(path) ? readFileSync(path, 'utf-8') : '# Pipeline — Pending URLs\n\n## Pending\n';
  if (text.includes(url)) return false;
  const cell = (s) => String(s || '').replace(/\s*\|\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  const entry = `- [${blocked ? '!' : ' '}] ${[url, cell(company) || '?', cell(role) || '?', cell(location), note ? `note: ${cell(note)}` : ''].filter(Boolean).join(' | ')}`;
  const lines = text.split('\n');
  let at = lines.findIndex((l) => /^##\s+Pending/i.test(l));
  if (at === -1) { lines.push('', '## Pending', ''); at = lines.length - 2; }
  let end = at + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  while (end > at + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, entry);
  writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'));
  return true;
}
