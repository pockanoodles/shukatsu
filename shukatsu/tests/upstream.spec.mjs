import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { forkHistory, merge, review } from '../core/upstream.mjs';

/**
 * The fork's history in miniature: upstream releases v1.1 and v1.2; the fork
 * edits b.mjs, edits and then reverts c.md, owns shukatsu/, keeps its own
 * README with merge=ours, and took v1.1's a.mjs as an update-system.mjs copy.
 */
function forkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'shukatsu-upstream-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  const commit = (msg, files) => { write(files); git('add', '-A'); git('commit', '-q', '-m', msg); };

  git('init', '-q', '-b', 'main');
  commit('upstream base', { 'a.mjs': 'export const a = 1;\n', 'b.mjs': 'export const b = 1;\n', 'c.md': 'c\n', 'e.md': 'x\ny\nz\n', 'README.md': 'career-ops\n' });
  git('branch', 'upstream-main');
  commit('fork: own paths, README, attributes', {
    'config/local-paths.txt': 'shukatsu/\n',
    'shukatsu/app.mjs': 'export const app = 1;\n',
    'README.md': 'Shukatsu\n',
    '.gitattributes': 'README.md merge=ours\n',
  });
  commit('fork: edit b', { 'b.mjs': 'export const b = "fork";\n' });
  commit('fork: edit c', { 'c.md': 'c, edited\n' });
  commit('fork: revert c', { 'c.md': 'c\n' });
  commit('chore: auto-update system files to v1.1', { 'a.mjs': 'export const a = 2;\n', 'e.md': 'x\nold\ny\nz\n', 'f.mjs': 'export const f = 1;\n' });

  git('switch', '-q', 'upstream-main');
  commit('upstream: a 2', { 'a.mjs': 'export const a = 2;\n', 'e.md': 'x\nold\ny\nz\n', 'f.mjs': 'export const f = 1;\n' });
  git('tag', 'career-ops-v1.1');
  git('rm', '-q', 'f.mjs');
  commit('upstream: a 3, b, c, README, a scanner', {
    'a.mjs': 'export const a = 3;\n',
    'b.mjs': 'export const b = "upstream";\n',
    'c.md': 'c, upstream\n',
    'e.md': 'x\ny\nZ\n',
    'README.md': 'career-ops, new\n',
    'd.mjs': "export const d = () => fetch('https://jobs.newboard.org/api');\nexport const e = () => fetch('/api/local');\n",
  });
  git('tag', 'career-ops-v1.2');
  git('switch', '-q', 'main');
  return dir;
}

test('the fork\'s own edits count net: a reverted edit is not one, and a copy is upstream\'s', () => {
  const dir = forkRepo();
  const base = spawnSync('git', ['merge-base', 'HEAD', 'career-ops-v1.2'], { cwd: dir, encoding: 'utf-8' }).stdout.trim();
  const { edited, copied } = forkHistory(dir, base);
  assert.deepEqual(edited, ['.gitattributes', 'README.md', 'b.mjs', 'config/local-paths.txt']);
  assert.deepEqual(copied, ['a.mjs', 'e.md', 'f.mjs']);
});

test('a file a merge brought back to upstream\'s content is not an edit, even with an older copy of it in the history', () => {
  const dir = forkRepo();
  const run = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  // Like a stopgap the fork made to a copied file, then dropped for upstream's fix on the merge.
  writeFileSync(join(dir, 'a.mjs'), 'export const a = "stopgap";\n');
  run('commit', '-q', '-am', 'fork: stopgap in a');
  merge(dir, 'career-ops-v1.2');
  run('checkout', '--theirs', 'a.mjs');
  run('checkout', '--ours', 'b.mjs');
  run('add', '-A');
  run('commit', '-q', '--no-edit');
  run('switch', '-q', 'upstream-main');
  writeFileSync(join(dir, 'a.mjs'), 'export const a = 4;\n');
  run('commit', '-q', '-am', 'upstream: a 4');
  run('tag', 'career-ops-v1.3');
  run('switch', '-q', 'update/v1.2');
  const { edited } = forkHistory(dir, run('merge-base', 'HEAD', 'career-ops-v1.3'));
  assert.ok(!edited.includes('a.mjs'), 'a.mjs is v1.2\'s content again; the v1.1 copy and the stopgap are both older than that merge');
  assert.ok(edited.includes('b.mjs'), 'the fork\'s own edit still counts');
});

test('merge stops, changing nothing, when git refuses to start the merge', () => {
  const dir = forkRepo();
  writeFileSync(join(dir, 'd.mjs'), 'mine, untracked\n');
  assert.throws(() => merge(dir, 'career-ops-v1.2'), /did not start merging career-ops-v1\.2.*untracked/s);
  assert.equal(readFileSync(join(dir, 'd.mjs'), 'utf-8'), 'mine, untracked\n');
  assert.equal(readFileSync(join(dir, 'a.mjs'), 'utf-8'), 'export const a = 2;\n', 'no release file was copied in');
});

test('a change made in an earlier merge commit survives the next merge', () => {
  const dir = forkRepo();
  const run = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  merge(dir, 'career-ops-v1.2');
  run('checkout', '--ours', 'b.mjs');
  // e.md was only ever touched by the update-system copy, so no ordinary fork commit names it.
  writeFileSync(join(dir, 'e.md'), 'x\ny\nZ, tuned in the merge\n');
  run('add', '-A');
  run('commit', '-q', '--no-edit');
  run('switch', '-q', 'upstream-main');
  writeFileSync(join(dir, 'a.mjs'), 'export const a = 4;\n');
  run('commit', '-q', '-am', 'upstream: a 4');
  run('tag', 'career-ops-v1.3');
  run('switch', '-q', 'update/v1.2');
  merge(dir, 'career-ops-v1.3');
  assert.equal(readFileSync(join(dir, 'e.md'), 'utf-8'), 'x\ny\nZ, tuned in the merge\n');
});

test('review names the carried edits, the copied files, and the new egress', () => {
  const r = review(dir0(), 'career-ops-v1.2');
  assert.deepEqual(r.carried, [
    { file: 'README.md', state: 'kept (merge=ours)' },
    { file: 'b.mjs', state: 'conflicts' },
  ], 'fork-only files (.gitattributes, local-paths.txt) are neither adopted nor in conflict');
  assert.deepEqual(r.copiedConflicts, ['a.mjs', 'e.md']);
  assert.deepEqual(r.egress.calls, [{ file: 'd.mjs', added: 1 }], 'a same-origin fetch never leaves the machine');
  assert.deepEqual(r.egress.hosts, [{ host: 'jobs.newboard.org', files: ['d.mjs'] }]);
});

test('merge takes upstream\'s side where the fork never edited, and leaves the fork\'s edits to a person', () => {
  const dir = forkRepo();
  const m = merge(dir, 'career-ops-v1.2');
  assert.equal(m.branch, 'update/v1.2');
  assert.deepEqual(m.resolved, ['a.mjs', 'e.md', 'f.mjs'], 'c.md merges cleanly: the fork reverted its edit');
  assert.equal(existsSync(join(dir, 'f.mjs')), false, 'a file upstream deleted leaves the disk too, so git add -A cannot bring it back');
  assert.equal(readFileSync(join(dir, 'e.md'), 'utf-8'), 'x\ny\nZ\n', 'a clean merge would have kept the copied "old" line upstream removed');
  assert.deepEqual(m.left, ['b.mjs']);
  assert.equal(readFileSync(join(dir, 'a.mjs'), 'utf-8'), 'export const a = 3;\n');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf-8'), 'Shukatsu\n', 'merge=ours keeps the fork\'s README');
  assert.throws(() => merge(dir, 'career-ops-v1.2'), /uncommitted changes/);
});

let cached = null;
function dir0() { return (cached ??= forkRepo()); }
