// tests/set-status-target.test.mjs — `--target KEY` writes the Target cell.
//
// The backfill path for rows whose Target is unknown: `--row N --target KEY`
// with no state keeps the status. The key is validated against the `outcomes:`
// keys of <workspace>/data/targets.yml before the tracker is touched.
//
// Run:  node --test tests/set-status-target.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const WITH_TARGET = [
  '| # | Date | Company | Via | Role | Target | Due | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|-----|------|--------|-----|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Acme Widgets | — | Widget Intern | — | — | — | Applied | — | — | first |',
  '| 2 | 2026-09-02 | Other Co | — | Analyst | 2028 | — | — | Interview | — | — | second |',
  '',
].join('\n');
const NO_TARGET = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-09-01 | Acme Widgets | Widget Intern | 4/5 | Applied | — | — | first |',
  '',
].join('\n');

function setup(content) {
  const dir = mkdtempSync(join(tmpdir(), 'set-status-target-'));
  mkdirSync(join(dir, 'data'));
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, content);
  writeFileSync(join(dir, 'data', 'targets.yml'), 'outcomes:\n  co-op:\n    goal: a\n  summer-27:\n    goal: b\n  "2028":\n    goal: c\n');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir, CAREER_OPS_TRACKER: tracker },
    });
    return { status: r.status, data: JSON.parse(r.stdout) };
  };
  return { dir, tracker, run, read: () => readFileSync(tracker, 'utf8'), done: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }) };
}
const cells = (text, num) => text.split('\n').find(l => new RegExp(`^\\|\\s*${num}\\s*\\|`).test(l)).split('|').slice(1, -1).map(s => s.trim());

test('--row N --target KEY sets Target, keeps status, touches nothing else', () => {
  const t = setup(WITH_TARGET);
  try {
    const before = t.read();
    const r = t.run('--row', '1', '--target', 'summer-27');
    assert.equal(r.status, 0);
    assert.equal(r.data.changed, true);
    assert.equal(r.data.target, 'summer-27');
    assert.equal(r.data.oldStatus, 'Applied');
    assert.equal(r.data.newStatus, 'Applied');
    const after = t.read();
    assert.deepEqual(cells(after, 1), ['1', '2026-09-01', 'Acme Widgets', '—', 'Widget Intern', 'summer-27', '—', '—', 'Applied', '—', '—', 'first']);
    assert.equal(after.replace('summer-27', '—'), before);
    // A target-only edit is not a transition: no ledger line, no follow-up seed.
    assert.equal(existsSync(join(t.dir, 'data', 'status-log.tsv')), false);
    assert.equal(r.data.followupSeedCandidate, undefined);
  } finally { t.done(); }
});

test('--target is idempotent', () => {
  const t = setup(WITH_TARGET);
  try {
    t.run('--row', '1', '--target', '2028');
    const after = t.read();
    const r = t.run('--row', '1', '--target', '2028');
    assert.equal(r.status, 0);
    assert.equal(r.data.changed, false);
    assert.equal(t.read(), after);
  } finally { t.done(); }
});

test('--dry-run reports the change and writes nothing', () => {
  const t = setup(WITH_TARGET);
  try {
    const before = t.read();
    const r = t.run('--row', '1', '--target', 'summer-27', '--dry-run');
    assert.equal(r.status, 0);
    assert.equal(r.data.changed, true);
    assert.equal(r.data.dryRun, true);
    assert.equal(t.read(), before);
  } finally { t.done(); }
});

test('an unknown key is rejected before the tracker is touched', () => {
  const t = setup(WITH_TARGET);
  try {
    const before = t.read();
    const r = t.run('--row', '1', '--target', 'summer-99');
    assert.equal(r.status, 1);
    assert.equal(r.data.code, 'invalid-target');
    assert.equal(t.read(), before);
  } finally { t.done(); }
});

test('--target combines with a state and a note, and works with a company selector', () => {
  const t = setup(WITH_TARGET);
  try {
    let r = t.run('--row', '2', 'Rejected', '--target', 'summer-27', '--note', 'declined');
    assert.equal(r.status, 0);
    assert.deepEqual(cells(t.read(), 2).slice(5, 12), ['summer-27', '—', '—', 'Rejected', '—', '—', 'second; declined']);
    r = t.run('Acme Widgets', '--target', 'co-op');
    assert.equal(r.status, 0);
    assert.equal(cells(t.read(), 1)[5], 'co-op');
  } finally { t.done(); }
});

test('a tracker without a Target column fails clearly and is untouched', () => {
  const t = setup(NO_TARGET);
  try {
    const before = t.read();
    const r = t.run('--row', '1', '--target', 'summer-27');
    assert.equal(r.status, 1);
    assert.equal(r.data.code, 'no-target-column');
    assert.equal(t.read(), before);
  } finally { t.done(); }
});

test('without --target the state is still required', () => {
  const t = setup(WITH_TARGET);
  try {
    assert.equal(t.run('--row', '1').status, 1);
  } finally { t.done(); }
});
