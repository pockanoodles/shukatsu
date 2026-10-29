// tests/merge-tracker-target-due.test.mjs — a headed addition's Target and Due
// cells reach the tracker.
//
// The tracker can carry Target and Due columns, but neither header was in the
// shared alias table, so merge-tracker mapped neither: every merged row got `—`
// in both, whatever the addition said. Target is validated against the
// `outcomes:` keys of <workspace>/data/targets.yml; an unknown key warns and
// writes `—`.
//
// Run:  node --test tests/merge-tracker-target-due.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedBatchStatePath } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Via | Role | Target | Due | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|-----|------|--------|-----|-------|--------|-----|--------|-------|',
  '| 1 | 2026-01-05 | Existing Co | — | Analyst | 2028 | 2026-12-01 | 3.0/5 | Applied | — | — | seed |',
  '',
].join('\n');

const HEAD = ['#', 'Date', 'Company', 'Via', 'Role', 'Target', 'Due', 'Score', 'Status', 'PDF', 'Report', 'Notes'];

/** Merge one headed addition into the fixture tracker. */
function merge({ score = '—', num = 2, company = 'Acme Widgets', role = 'Widget Intern', target, due, targetsYml, tracker = TRACKER }) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-merge-target-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const trackerPath = join(dir, 'data', 'applications.md');
    const addsDir = join(dir, 'adds');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(trackerPath, tracker);
    if (targetsYml !== null) {
      writeFileSync(join(dir, 'data', 'targets.yml'),
        targetsYml ?? 'outcomes:\n  co-op:\n    goal: a\n  summer-27:\n    goal: b\n  "2028":\n    goal: c\n');
    }
    const row = [String(num), '2026-02-10', company, '—', role, target ?? '', due ?? '', score, 'Applied', '❌', '—', 'n'];
    writeFileSync(join(addsDir, `${String(num).padStart(3, '0')}-x.tsv`), `${HEAD.join('\t')}\n${row.join('\t')}\n`);
    const r = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, CAREER_OPS_TRACKER: trackerPath, CAREER_OPS_ADDITIONS: addsDir, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(addsDir) },
    });
    const rows = readFileSync(trackerPath, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
    const cells = (line) => line.split('|').slice(1, -1).map(s => s.trim());
    return { r, rows, cells, row: rows.map(cells).find(c => c[0] === String(num)), out: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

test('a valid Target and a Due reach their cells', () => {
  const { row, rows } = merge({ target: 'summer-27', due: '2026-11-15 apply on the portal' });
  assert.ok(row, 'new row was not written');
  assert.equal(row[5], 'summer-27');
  assert.equal(row[6], '2026-11-15 apply on the portal');
  assert.equal(row.length, 12);
  assert.equal(rows.length, 2);
});

test('a numeric-looking Target key matches the quoted YAML key', () => {
  assert.equal(merge({ target: '2028' }).row[5], '2028');
});

test('an unknown Target warns and writes an em dash; Due still lands', () => {
  const { row, out } = merge({ target: 'summer-99', due: '2026-12-31' });
  assert.equal(row[5], '—');
  assert.equal(row[6], '2026-12-31');
  assert.match(out, /unknown Target "summer-99"/);
});

test('absent Target and Due stay em dashes', () => {
  const { row } = merge({});
  assert.equal(row[5], '—');
  assert.equal(row[6], '—');
});

test('a workspace with no targets.yml treats every Target as unknown', () => {
  const { row, out } = merge({ target: 'summer-27', targetsYml: null });
  assert.equal(row[5], '—');
  assert.match(out, /unknown Target/);
});

test('re-evaluating an existing row keeps its Target and Due when the addition has none, and replaces them when it does', () => {
  const kept = merge({ num: 3, company: 'Existing Co', role: 'Analyst', score: '4.0/5', target: '', due: '' });
  const keptRow = kept.rows.map(kept.cells).find(c => c[2] === 'Existing Co');
  assert.equal(keptRow[5], '2028');
  assert.equal(keptRow[6], '2026-12-01');
  const changed = merge({ num: 3, company: 'Existing Co', role: 'Analyst', score: '4.0/5', target: 'summer-27', due: '2027-01-02' });
  const changedRow = changed.rows.map(changed.cells).find(c => c[2] === 'Existing Co');
  assert.equal(changedRow[5], 'summer-27');
  assert.equal(changedRow[6], '2027-01-02');
});
