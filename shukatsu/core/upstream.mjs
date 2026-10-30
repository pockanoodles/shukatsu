/**
 * Taking career-ops releases into the fork: review a release, merge it on a
 * branch, or pick one fix between releases.
 *
 * The fork merges upstream's release tags with git, never with
 * `update-system.mjs apply`. apply copies files instead of merging, so a file
 * the fork has edited is kept and stops receiving upstream changes, and the
 * copy leaves no ancestry, so the next real merge conflicts on every line the
 * copy touched. A merge keeps both sides and moves the merge-base forward.
 *
 * Every function takes `engine`, the repo root, and runs git there.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SEAM, seamClosure } from './seam.mjs';

const TAG_GLOB = 'career-ops-v*';
const AUTO_UPDATE = /^chore: auto-update system files/;
const AGENT_FILES = /^(AGENTS|CLAUDE|CODEX|GEMINI|OPENCODE|KIMI)\.md$|^modes\/|^\.claude\/|^\.agents\/|^batch\/batch-prompt\.md$/;
/**
 * A line that calls out, or imports a way to: fetch, http(s).request/get (also
 * imported under another name), a socket, or a client library. Shared with
 * tests/dataflow.spec.mjs, which holds the fork's own code to the same test.
 */
export const NETWORK_CALL = /\bfetch\s*\(|\bhttps?2?\.(request|get|connect)\s*\(|new\s+WebSocket\s*\(|\bundici\b|\baxios\b|import\s*\{[^}]*\b(request|get|connect)\b[^}]*\}\s*from\s*['"](node:)?https?2?['"]|import\s*\{[^}]*\b(connect|createConnection)\b[^}]*\}\s*from\s*['"](node:)?(net|tls)['"]/;
const HOST = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const PLACEHOLDER_HOST = /(^|\.)(example\.(com|org|net)|localhost|test|invalid)$/;
const CODE = /\.(mjs|cjs|js|ts|tsx|go)$/;
const NOT_SHIPPED = /^(tests?|test-fixtures|docs|\.github)\/|\.test\.mjs$|\.spec\.mjs$|-tests\.mjs$|_test\.go$|^test-all\.mjs$/;
// A fetch of a path on the page's own origin ('/api/...') never leaves the machine.
const SAME_ORIGIN = /\bfetch\s*\(\s*[`'"]\//;

function git(engine, args, { ok = false } = {}) {
  const r = spawnSync('git', args, { cwd: engine, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  if (!ok && r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return { status: r.status, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trim() };
}

const lines = (s) => s.split('\n').filter(Boolean);

/** The paths this fork owns, from config/local-paths.txt: a trailing "/" is a prefix. */
export function forkPaths(engine) {
  const file = join(engine, 'config', 'local-paths.txt');
  const declared = existsSync(file) ? lines(readFileSync(file, 'utf-8')).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
  return (path) => declared.some((d) => (d.endsWith('/') ? path.startsWith(d) : path === d));
}

/** The newest career-ops release tag, after fetching upstream's tags. */
export function latestRelease(engine, { fetch = true } = {}) {
  if (fetch) git(engine, ['fetch', '-q', 'upstream', '--tags']);
  const [tag] = lines(git(engine, ['tag', '-l', TAG_GLOB, '--sort=-v:refname']).out);
  if (!tag) throw new Error(`no ${TAG_GLOB} tag found; is the "upstream" remote career-ops?`);
  return tag;
}

/** The newest release already merged into HEAD, or null when none has been (only copied in). */
export function lastMerged(engine) {
  for (const tag of lines(git(engine, ['tag', '-l', TAG_GLOB, '--sort=-v:refname']).out)) {
    if (git(engine, ['merge-base', '--is-ancestor', tag, 'HEAD'], { ok: true }).status === 0) return tag;
  }
  return null;
}

const blob = (engine, ref, file) => {
  const r = git(engine, ['rev-parse', `${ref}:${file}`], { ok: true });
  return r.status === 0 ? r.out : null;
};

/**
 * Upstream's files the fork has changed since `base`, net: `edited` differ at
 * HEAD from both `base` and the newest `update-system.mjs apply` copy of the
 * file, so an edit later reverted doesn't count, and neither does a file a
 * merge since the copy brought back to upstream's content. `copied` are files
 * only those copies touched, and `lastCopy` maps each copied file to its newest copy.
 */
export function forkHistory(engine, base) {
  const owned = forkPaths(engine);
  const touched = new Set();
  const lastCopy = new Map();
  // Newest first, so the first copy commit seen for a file is its latest.
  const log = git(engine, ['log', '--no-merges', '--format=%x00%H %s', '--name-only', `${base}..HEAD`]).out;
  for (const chunk of log.split('\0').filter(Boolean)) {
    const [head, ...files] = lines(chunk);
    const [sha, ...subject] = head.split(' ');
    const isCopy = AUTO_UPDATE.test(subject.join(' '));
    for (const f of files.filter((p) => !owned(p))) {
      if (!isCopy) touched.add(f);
      else if (!lastCopy.has(f)) lastCopy.set(f, sha);
    }
  }
  const edited = [...touched].filter((f) => {
    const ours = blob(engine, 'HEAD', f);
    return ours !== blob(engine, base, f) && (!lastCopy.has(f) || ours !== blob(engine, lastCopy.get(f), f));
  }).sort();
  const copied = [...lastCopy.keys()].filter((f) => !edited.includes(f)).sort();
  return { edited, copied, lastCopy };
}

/** Network calls and hosts a release adds to shipped code, from its added lines. */
export function egressChanges(engine, base, tag) {
  const diff = git(engine, ['diff', '-U0', '--no-color', base, tag]).out;
  const calls = new Map();
  const added = new Map();
  const removed = new Set();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : null; continue; }
    if (!file || !CODE.test(file) || NOT_SHIPPED.test(file)) continue;
    if (line.startsWith('-') && !line.startsWith('---')) for (const m of line.matchAll(HOST)) removed.add(m[1].toLowerCase());
    if (!line.startsWith('+')) continue;
    const text = line.slice(1).trim();
    if (text.startsWith('//') || text.startsWith('*')) continue;
    if (NETWORK_CALL.test(text) && !SAME_ORIGIN.test(text)) calls.set(file, (calls.get(file) || 0) + 1);
    for (const m of text.matchAll(HOST)) {
      const host = m[1].toLowerCase();
      if (PLACEHOLDER_HOST.test(host)) continue;
      if (!added.has(host)) added.set(host, new Set());
      added.get(host).add(file);
    }
  }
  const hosts = [...added].filter(([h]) => !removed.has(h)).map(([host, files]) => ({ host, files: [...files].sort() }));
  return { calls: [...calls].map(([f, n]) => ({ file: f, added: n })).sort((a, b) => a.file.localeCompare(b.file)), hosts: hosts.sort((a, b) => a.host.localeCompare(b.host)) };
}

/** What a release changes that matters to this fork. */
export function review(engine, tag) {
  const base = git(engine, ['merge-base', 'HEAD', tag]).out;
  const owned = forkPaths(engine);
  const changed = lines(git(engine, ['diff', '--name-only', base, tag]).out).filter((f) => !owned(f));
  const changedSet = new Set(changed);
  const show = (p) => { const r = git(engine, ['show', `${tag}:${p}`], { ok: true }); return r.status === 0 ? r.out : null; };
  const direct = new Set([...Object.keys(SEAM.imports), ...SEAM.files]);
  const seam = seamClosure(engine, show).filter((p) => changedSet.has(p)).map((p) => ({ file: p, direct: direct.has(p) }));
  const { edited, copied } = forkHistory(engine, base);
  // Only files upstream has too: a fork-only file can't be adopted or conflict.
  const carried = edited.filter((f) => blob(engine, base, f) !== null || blob(engine, tag, f) !== null).map((file) => {
    const ours = blob(engine, 'HEAD', file);
    const keepsOurs = git(engine, ['check-attr', 'merge', '--', file]).out.endsWith(': ours');
    const state = ours !== null && ours === blob(engine, tag, file) ? 'adopted'
      : keepsOurs ? 'kept (merge=ours)' : changedSet.has(file) ? 'conflicts' : 'clean';
    return { file, state };
  });
  return {
    tag,
    base,
    lastMerged: lastMerged(engine),
    commits: Number(git(engine, ['rev-list', '--count', `${base}..${tag}`]).out),
    changed: changed.length,
    seam,
    egress: egressChanges(engine, base, tag),
    agent: changed.filter((f) => AGENT_FILES.test(f)),
    carried,
    copiedConflicts: copied.filter((f) => changedSet.has(f)),
  };
}

/** Files listed one by one, except a modes/ subfolder with more than one, which reads as one line. */
function groupDirs(files) {
  const byDir = new Map();
  for (const f of files) {
    const m = f.match(/^(modes\/[^/]+)\//);
    if (m) byDir.set(m[1], [...(byDir.get(m[1]) || []), f]);
  }
  const grouped = new Set([...byDir].filter(([, fs]) => fs.length > 1).map(([d]) => d));
  const out = files.filter((f) => !grouped.has((f.match(/^(modes\/[^/]+)\//) || [])[1]));
  for (const d of grouped) out.push(`${d}/  (${byDir.get(d).length} files)`);
  return out.sort();
}

export function reviewText(r) {
  const out = [];
  const list = (items, fmt = (x) => x) => (items.length ? items.map((x) => `  ${fmt(x)}`) : ['  none']);
  out.push(`career-ops ${r.tag}: ${r.commits} commits, ${r.changed} upstream files changed since ${r.base.slice(0, 8)}${r.lastMerged ? ` (last merged ${r.lastMerged})` : ' (no release merged yet: the last one was copied in)'}`);
  out.push('', 'Seam: engine code the app imports or runs, and what it loads (run `npm test` in shukatsu/ after merging):');
  out.push(...list(r.seam, (s) => `${s.file}${s.direct ? '' : '  (loaded by the seam)'}`));
  out.push('', 'Egress: network calls and hosts added to shipped code (each needs a DATAFLOW.md row or a reason it is already covered):');
  out.push(...list(r.egress.calls, (c) => `${c.file}  +${c.added} call${c.added === 1 ? '' : 's'}`));
  out.push(...(r.egress.hosts.length ? r.egress.hosts.map((h) => `  host ${h.host}  (${h.files.join(', ')})`) : []));
  out.push('', 'Agent behaviour: instructions and modes that change how agents act in this repo:');
  out.push(...list(groupDirs(r.agent)));
  out.push('', 'Carried: upstream files the fork edits (adopted means upstream now has the same content, so the edit can go):');
  out.push(...list(r.carried, (c) => `${c.file}  ${c.state}`));
  if (r.copiedConflicts.length) out.push('', `${r.copiedConflicts.length} files were copied in by update-system.mjs and changed again upstream. merge resolves them to upstream's version, since the fork never edited them.`);
  return `${out.join('\n')}\n`;
}

/**
 * Merge a release on its own branch, without committing. Conflicts in files
 * the fork never edited are resolved to upstream's side; the rest are left for
 * a person. Returns the branch and both lists.
 */
export function merge(engine, tag) {
  if (git(engine, ['status', '--porcelain', '--untracked-files=no']).out) throw new Error('the working tree has uncommitted changes; commit or stash them first');
  if (git(engine, ['config', '--get', 'merge.ours.driver'], { ok: true }).status !== 0) git(engine, ['config', 'merge.ours.driver', 'true']);
  const base = git(engine, ['merge-base', 'HEAD', tag]).out;
  const { edited, lastCopy } = forkHistory(engine, base);
  const fork = new Set(edited);
  const owned = forkPaths(engine);
  const branch = `update/${tag.replace(/^career-ops-/, '')}`;
  git(engine, ['switch', '-q', '-c', branch]);
  const started = git(engine, ['merge', '--no-ff', '--no-commit', tag], { ok: true });
  // A merge git refused (an untracked file in the way, say) leaves no MERGE_HEAD.
  // Normalizing after one would copy the release in over HEAD, which is what this replaces.
  if (git(engine, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { ok: true }).status !== 0) {
    throw new Error(`git did not start merging ${tag}, so nothing was changed: ${started.err || started.out}`);
  }
  const resolved = [];
  const left = [];
  for (const file of lines(git(engine, ['diff', '--name-only', '--diff-filter=U']).out)) {
    if (fork.has(file)) { left.push(file); continue; }
    const theirs = lines(git(engine, ['ls-files', '-u', '--', file]).out).some((l) => l.split(/\s+/)[2] === '3');
    if (theirs) {
      git(engine, ['checkout', '--theirs', '--', file]);
      git(engine, ['add', '--', file]);
    } else {
      git(engine, ['rm', '-q', '--', file]);
    }
    resolved.push(file);
  }
  // A file the fork never edited can still merge cleanly into a blend nobody
  // wrote: an update-system.mjs copy left the fork's side off the merge base, so
  // git keeps copied lines upstream has since removed. Such a file is set to the
  // tag's content whether or not git called it a conflict. Whether the fork edited
  // it is judged by content, not by which commits touched it: the fork's side must
  // be upstream's own (the merge base) or a copy, so a change made in an earlier
  // merge commit, which forkHistory doesn't see, is left to git.
  for (const file of lines(git(engine, ['diff', '--cached', '--name-only', tag]).out)) {
    if (owned(file) || fork.has(file) || resolved.includes(file)) continue;
    const ours = blob(engine, 'HEAD', file);
    const upstreams = ours !== null && (ours === blob(engine, base, file) || (lastCopy.has(file) && ours === blob(engine, lastCopy.get(file), file)));
    if (!upstreams) continue;
    if (blob(engine, tag, file) === null) git(engine, ['rm', '-q', '-f', '--', file]);
    else git(engine, ['checkout', tag, '--', file]);
    resolved.push(file);
  }
  resolved.sort();
  return { branch, tag, resolved, left };
}

export function mergeText(m) {
  const out = [`On ${m.branch}: ${m.tag} merged, not committed.`];
  out.push(`Resolved to upstream's version (files the fork never edited): ${m.resolved.length}`);
  out.push(m.left.length ? `Left for you (files the fork edits too):\n${m.left.map((f) => `  ${f}`).join('\n')}` : 'Nothing left to resolve by hand.');
  out.push('', 'Then:',
    '  1. resolve anything listed above and `git add` it',
    '  2. `npm install` (upstream ships no root lockfile), and `npm ci` in shukatsu/ if its lockfile changed',
    '  3. `npm test` in shukatsu/ passes, and `CAREER_OPS_DATA_DIR=$PWD node test-all.mjs` shows no failure main lacks',
    '  4. give DATAFLOW.md a row for any egress the review flagged',
    `  5. \`git commit --no-edit\`, then \`git switch main && git merge --ff-only ${m.branch}\``);
  return `${out.join('\n')}\n`;
}

/** Take one upstream commit between releases, recording where it came from. */
export function pick(engine, sha) {
  git(engine, ['fetch', '-q', 'upstream']);
  if (git(engine, ['merge-base', '--is-ancestor', sha, 'upstream/main'], { ok: true }).status !== 0) throw new Error(`${sha} is not on upstream/main`);
  git(engine, ['cherry-pick', '-x', sha]);
  return git(engine, ['log', '-1', '--format=%h %s']).out;
}
