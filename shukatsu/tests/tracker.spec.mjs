import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { setTargetDue } from '../core/tracker.mjs';
import { run, sessionPrincipal, tokenPrincipal } from '../core/ops/index.mjs';
import { createAgent, issueToken } from '../core/people.mjs';
import { makeRoot, people, read, targetsRoot, trackerCells } from './helpers.mjs';

/**
 * Target and Due: the tracker columns the fork fills itself, since upstream's
 * merge-tracker has no field for them (seam.spec checks it leaves them alone).
 */

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const tracker = (root) => read(root, 'data/applications.md');
const refuses = (p, re) => assert.rejects(p, (e) => { assert.match(e.message, re); return true; });

test('Target and Due land in their cells, and nothing else in the tracker moves', async () => {
  const root = targetsRoot();
  const before = tracker(root).split('\n');
  const r = await setTargetDue(root, 1, { target: 'summer-27', due: '2026-11-20' });
  assert.deepEqual(r, { num: 1, target: 'summer-27', due: '2026-11-20', changed: true });
  const after = tracker(root).split('\n');
  const i = after.findIndex((l) => l.startsWith('| 1 |'));
  assert.deepEqual(after.filter((_, j) => j !== i), before.filter((_, j) => j !== i), 'every other line is byte for byte the same');
  const row = trackerCells(root, 1);
  assert.deepEqual([row.Status, row.Score, row.Company, row.Target, row.Due], ['Evaluated', '4.0/5', 'Acme', 'summer-27', '2026-11-20']);
});

test('a Target that YAML reads as a number still matches its key', async () => {
  const root = targetsRoot();
  assert.equal((await setTargetDue(root, 1, { target: '2028' })).target, '2028');
});

test('an unknown Target is refused, naming the real ones, before the tracker is touched', async () => {
  const root = targetsRoot();
  const before = tracker(root);
  await refuses(setTargetDue(root, 1, { target: 'fall-26' }), /2028, summer-27/);
  assert.equal(tracker(root), before);
});

test('without data/targets.yml there is no Target to set', async () => {
  const root = targetsRoot();
  rmSync(join(root, 'data', 'targets.yml'));
  await refuses(setTargetDue(root, 1, { target: 'summer-27' }), /none yet/);
});

test('Due is a real date, and a short note may follow it', async () => {
  const root = targetsRoot();
  await refuses(setTargetDue(root, 1, { due: '2026-02-30' }), /not a Due date/);
  await refuses(setTargetDue(root, 1, { due: '11/20' }), /not a Due date/);
  assert.equal((await setTargetDue(root, 1, { due: '2026-11-20 19:00 ET' })).due, '2026-11-20 19:00 ET');
});

test('the same value again changes nothing, and — clears a cell', async () => {
  const root = targetsRoot();
  const before = tracker(root);
  assert.equal((await setTargetDue(root, 2, { target: '2028' })).changed, false);
  assert.equal(tracker(root), before, 'an unchanged row is not rewritten');
  const r = await setTargetDue(root, 2, { due: '—' });
  assert.deepEqual([r.target, r.due, r.changed], ['2028', '—', true]);
});

test('a tracker without the column, a missing row, and a row that does not line up are all refused untouched', async () => {
  const root = targetsRoot();
  await refuses(setTargetDue(root, 9, { target: 'summer-27' }), /no row 9/);
  writeFileSync(join(root, 'data', 'applications.md'), tracker(root).replace('| 1 | 2026-10-01 | Acme |', '| 1 | 2026-10-01 | Acme | Robotics |'));
  const skewed = tracker(root);
  await refuses(setTargetDue(root, 1, { target: 'summer-27' }), /13 cells but the header has 12/);
  assert.equal(tracker(root), skewed);
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-01 | Acme | Analyst | 4.0/5 | Evaluated | ❌ | — |  |\n');
  const plain = tracker(root);
  await refuses(setTargetDue(root, 1, { target: 'summer-27' }), /no Target column/);
  assert.equal(tracker(root), plain);
});

test('the row is found by its # wherever that column sits', async () => {
  const root = targetsRoot();
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n\n| Company | # | Date | Role | Score | Status | PDF | Report | Notes | Target | Due |\n|---|---|---|---|---|---|---|---|---|---|---|\n| Acme | 1 | 2026-10-01 | Analyst | 4.0/5 | Evaluated | ❌ | — |  | — | — |\n');
  await setTargetDue(root, 1, { target: 'summer-27', due: '2026-11-20' });
  assert.equal(tracker(root).split('\n')[4], '| Acme | 1 | 2026-10-01 | Analyst | 4.0/5 | Evaluated | ❌ | — |  | summer-27 | 2026-11-20 |');
});

test('a summary table above the tracker is passed over', async () => {
  const root = targetsRoot();
  writeFileSync(join(root, 'data', 'applications.md'), tracker(root).replace('# Applications Tracker\n', '# Applications Tracker\n\n| Metric | Count |\n|---|---|\n| Applied | 1 |\n'));
  assert.equal((await setTargetDue(root, 1, { target: 'summer-27' })).target, 'summer-27');
  assert.match(tracker(root), /\| Applied \| 1 \|/, 'the summary is left alone');
});

test('a Due on a tracker with no Due column is refused before any row goes in', async () => {
  const root = makeRoot();
  const { owner } = people(root);
  await refuses(run(root, sessionPrincipal(owner), 'tracker.add', { company: 'Initech', role: 'Analyst', due: '2026-12-01' }), /no Due column/);
  assert.equal(existsSync(join(root, 'data', 'applications.md')), false, 'not even the empty tracker');
});

test('an agent can add a row with its Target and Due, and a bad Target adds no row', async () => {
  const root = targetsRoot();
  const { owner } = people(root);
  const agent = createAgent(root, { actor: owner, name: 'Claude Code on the laptop' });
  const { token } = issueToken(root, { actor: owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  const agentP = tokenPrincipal(root, token);
  const { num } = await run(root, agentP, 'tracker.add', { company: 'Initech', role: 'Analyst', target: 'summer-27', due: '2026-12-01' });
  assert.deepEqual([trackerCells(root, num).Target, trackerCells(root, num).Due], ['summer-27', '2026-12-01']);
  const rows = tracker(root);
  await refuses(run(root, agentP, 'tracker.add', { company: 'Hooli', role: 'Analyst', target: 'someday' }), /not a Target/);
  assert.equal(tracker(root), rows);
  await assert.rejects(run(root, agentP, 'tracker.setTargetDue', { num: 1, target: '2028' }), 'filling one in later is the candidate\'s, from the app or the terminal');
  const later = await run(root, sessionPrincipal(owner), 'tracker.setTargetDue', { num: 1, target: '2028' });
  assert.deepEqual([later.target, later.changed], ['2028', true]);
});

test('adding a company+role already tracked updates that row, and its Target lands there', async () => {
  const root = targetsRoot();
  const { owner } = people(root);
  const { num } = await run(root, sessionPrincipal(owner), 'tracker.add', { company: 'Globex', role: 'Data Analyst', target: 'summer-27' });
  assert.equal(num, 2, 'the existing row, not the reserved number');
  assert.equal(trackerCells(root, 2).Target, 'summer-27');
  assert.equal(tracker(root).split('\n').filter((l) => l.includes('| Globex |')).length, 1, 'still one Globex row');
});

test('the Target goes to the row the add reached, even when the same merge changes another row', async () => {
  const root = targetsRoot();
  const { owner } = people(root);
  const dir = join(root, 'batch', 'tracker-additions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '1-acme.tsv'), 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n1\t2026-10-20\tAcme\tAnalyst\tEvaluated\t4.4/5\t❌\t—\tre-scored\n');
  const { num } = await run(root, sessionPrincipal(owner), 'tracker.add', { company: 'Globex', role: 'Data Analyst', target: 'summer-27' });
  assert.equal(num, 2);
  assert.equal(trackerCells(root, 1).Score, '4.4/5', 'the other addition did merge in the same run');
  assert.deepEqual([trackerCells(root, 1).Target, trackerCells(root, 2).Target], ['—', 'summer-27']);
});

test('target.mjs sets them from the terminal, through the registry', () => {
  const root = targetsRoot();
  people(root);
  const cli = (...a) => spawnSync(process.execPath, [join(APP, 'target.mjs'), ...a], {
    encoding: 'utf-8', env: { ...process.env, CAREER_OPS_DATA_DIR: root, SHUKATSU_URL: 'http://127.0.0.1:9' },
  });
  const ok = cli('1', '--target', 'summer-27', '--due', '2026-11-20 19:00 ET');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /#1: Target summer-27, Due 2026-11-20 19:00 ET/);
  assert.equal(cli('1').status, 2, 'neither flag is a usage error');
  const bad = cli('1', '--target', 'fall-26');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a Target/);
});
