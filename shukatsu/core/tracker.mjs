/**
 * The application tracker and the pipeline inbox, read through upstream's own
 * parsers and written only through upstream's canonical CLIs:
 *
 *   status change  set-status.mjs --row N (locked, validated, atomic, logged)
 *   new row        batch/tracker-additions/*.tsv + merge-tracker.mjs
 *   inbox item     data/pipeline.md, appended under "## Pending"
 *
 * The tracker is never edited by hand here: those CLIs hold the lock and the
 * states contract (templates/states.yml), and the status log depends on them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import * as yaml from 'js-yaml';
import { resolveTrackerPath, resolveTrackerPathForWrite } from '../../path-resolver.mjs';
import { parseTrackerRow, resolveColumns } from '../../tracker-parse.mjs';
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
 * exited 0.
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
  writeFileSync(join(dir, `${num}-${slug}.tsv`), `${header.join('\t')}\n${row.join('\t')}\n`);
  const merged = runEngine('merge-tracker.mjs', [], root);
  runEngine('reserve-report-num.mjs', ['--release', num], root);
  const landed = readTracker(root).rows.some((r) => r.num === Number(num));
  return { ok: merged.ok && landed, num: landed ? Number(num) : null, out: landed ? merged.out : `the row didn't reach the tracker: ${merged.out.split('\n').slice(-3).join(' ')}` };
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
