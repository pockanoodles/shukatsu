/**
 * Record every accepted change to the truth files as a commit in the data
 * root's own git repo. That history is the audit trail and the undo: who
 * confirmed what, when, and who proposed it.
 *
 * Only the files the change touched are committed (a pathspec commit), never
 * whatever else happens to be staged. Commits are skipped, not forced, when
 * the data root isn't its own repo, when SHUKATSU_GIT=0, or when the data root
 * is the engine checkout itself: the engine is a public fork, and personal
 * data must never be committed there.
 */

import { spawnSync } from 'child_process';
import { realpathSync } from 'fs';
import { ENGINE } from './trace.mjs';

const git = (cwd, args, env = {}) => spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...env } });

function toplevel(dir) {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.status === 0 ? realpathSync(r.stdout.trim()) : null;
}

export function gitEnabled(root) {
  if (process.env.SHUKATSU_GIT === '0') return false;
  const top = toplevel(root);
  if (!top) return false;
  return top === realpathSync(root) && top !== toplevel(ENGINE);
}

function identity(person, root) {
  // The candidate's own decisions are signed with the data root's git identity
  // when their account has no email, so their history stays one person.
  if (person?.role === 'owner' && !person.email) {
    const email = git(root, ['config', 'user.email']).stdout.trim();
    if (email) return { name: git(root, ['config', 'user.name']).stdout.trim() || person.name, email };
  }
  const name = person?.name || 'shukatsu';
  const email = person?.email || `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'user'}@shukatsu.local`;
  return { name, email };
}

/**
 * Commit `paths` (relative to the data root) with `message`. `author` is the
 * person whose decision it was; trailers name who proposed it.
 */
export function commitPaths(root, paths, message, { author, trailers = {} } = {}) {
  if (!paths.length || !gitEnabled(root)) return { committed: false };
  const add = git(root, ['add', '--', ...paths]);
  if (add.status !== 0) return { committed: false, error: add.stderr.trim() };
  const diff = git(root, ['diff', '--cached', '--quiet', '--', ...paths]);
  if (diff.status === 0) return { committed: false };
  const who = identity(author, root);
  const body = Object.entries(trailers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  const msg = body ? `${message}\n\n${body}` : message;
  // The committer is this machine's git identity when it has one; a fresh
  // server often doesn't, so fall back to the author rather than fail.
  const env = git(root, ['config', 'user.email']).stdout.trim() ? {} : { GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email };
  const r = git(root, ['commit', '-q', '-m', msg, '--author', `${who.name} <${who.email}>`, '--', ...paths], env);
  if (r.status !== 0) return { committed: false, error: (r.stderr || r.stdout).trim() };
  return { committed: true, sha: git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim() };
}

/** Recent commits touching `path`, newest first: [{sha, date, author, subject}]. */
export function history(root, path, limit = 30) {
  if (!toplevel(root)) return [];
  const r = git(root, ['log', `-${limit}`, '--format=%h%x1f%as%x1f%an%x1f%s', '--', path]);
  if (r.status !== 0) return [];
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => {
    const [sha, date, author, subject] = l.split('\x1f');
    return { sha, date, author, subject };
  });
}
