import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
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
  commit('upstream base', { 'a.mjs': 'export const a = 1;\n', 'b.mjs': 'export const b = 1;\n', 'c.md': 'c\n', 'README.md': 'career-ops\n' });
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
  commit('chore: auto-update system files to v1.1', { 'a.mjs': 'export const a = 2;\n' });

  git('switch', '-q', 'upstream-main');
  commit('upstream: a 2', { 'a.mjs': 'export const a = 2;\n' });
  git('tag', 'career-ops-v1.1');
  commit('upstream: a 3, b, c, README, a scanner', {
    'a.mjs': 'export const a = 3;\n',
    'b.mjs': 'export const b = "upstream";\n',
    'c.md': 'c, upstream\n',
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
  assert.deepEqual(copied, ['a.mjs']);
});

test('review names the carried edits, the copied files, and the new egress', () => {
  const r = review(dir0(), 'career-ops-v1.2');
  assert.deepEqual(r.carried, [
    { file: 'README.md', state: 'kept (merge=ours)' },
    { file: 'b.mjs', state: 'conflicts' },
  ], 'fork-only files (.gitattributes, local-paths.txt) are neither adopted nor in conflict');
  assert.deepEqual(r.copiedConflicts, ['a.mjs']);
  assert.deepEqual(r.egress.calls, [{ file: 'd.mjs', added: 1 }], 'a same-origin fetch never leaves the machine');
  assert.deepEqual(r.egress.hosts, [{ host: 'jobs.newboard.org', files: ['d.mjs'] }]);
});

test('merge takes upstream\'s side where the fork never edited, and leaves the fork\'s edits to a person', () => {
  const dir = forkRepo();
  const m = merge(dir, 'career-ops-v1.2');
  assert.equal(m.branch, 'update/v1.2');
  assert.deepEqual(m.resolved, ['a.mjs'], 'c.md merges cleanly: the fork reverted its edit');
  assert.deepEqual(m.left, ['b.mjs']);
  assert.equal(readFileSync(join(dir, 'a.mjs'), 'utf-8'), 'export const a = 3;\n');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf-8'), 'Shukatsu\n', 'merge=ours keeps the fork\'s README');
  assert.throws(() => merge(dir, 'career-ops-v1.2'), /uncommitted changes/);
});

let cached = null;
function dir0() { return (cached ??= forkRepo()); }
