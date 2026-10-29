import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadProfile } from '../core/facts.mjs';
import { render, withBanner } from '../core/render.mjs';
import { acceptInvite, createInvite } from '../core/people.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'root');

/** A throwaway data root: the fixture, a rendered cv.md, and its own git repo. */
export function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'shukatsu-test-'));
  cpSync(FIXTURE, root, { recursive: true });
  writeFileSync(join(root, 'cv.md'), withBanner(render(loadProfile(root)).text));
  writeFileSync(join(root, '.gitignore'), '.shukatsu/\n');
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return root;
}

export const read = (root, rel) => readFileSync(join(root, rel), 'utf-8');
export const gitLog = (root) => spawnSync('git', ['log', '--format=%an|%s|%b%x1e'], { cwd: root, encoding: 'utf-8' }).stdout;

/** An owner and an editor, signed up through real invites. */
export function people(root) {
  const ownerToken = createInvite(root, { actor: null, role: 'owner', name: 'Owner Person' });
  const owner = acceptInvite(root, ownerToken, { login: 'owner', password: 'correct horse battery' });
  const editorToken = createInvite(root, { actor: owner, role: 'editor', name: 'Mom', relation: 'Mother', lang: 'ja' });
  const editor = acceptInvite(root, editorToken, { login: 'mom', password: 'another long secret' });
  const reviewerToken = createInvite(root, { actor: owner, role: 'reviewer', name: 'Mentor' });
  const reviewer = acceptInvite(root, reviewerToken, { login: 'mentor', password: 'yet another secret' });
  return { owner, editor, reviewer };
}

/** A data root whose tracker has Target and Due columns, and the outcomes they name. */
export function targetsRoot() {
  const root = makeRoot();
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'targets.yml'), 'outcomes:\n  summer-27:\n    label: Summer 2027 internship\n  2028:\n    label: Full-time from 2028\n');
  writeFileSync(join(root, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Via | Role | Target | Due | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|-----|------|--------|-----|-------|--------|-----|--------|-------|',
    '| 1 | 2026-10-01 | Acme | — | Analyst | — | — | 4.0/5 | Evaluated | ❌ | — |  |',
    '| 2 | 2026-10-02 | Globex | — | Data Analyst | 2028 | 2026-11-04 | 3.8/5 | Applied | ❌ | — | sent |',
    '',
  ].join('\n'));
  return root;
}

/** Row `num` of the tracker as { label: cell }. */
export function trackerCells(root, num) {
  const lines = read(root, 'data/applications.md').split('\n');
  const split = (l) => l.trim().slice(1, -1).split('|').map((c) => c.trim());
  const labels = split(lines.find((l) => /^\|\s*#\s*\|/.test(l)));
  const row = lines.map(split).find((c) => Number(c[0]) === num);
  return row ? Object.fromEntries(labels.map((l, i) => [l, row[i]])) : null;
}
