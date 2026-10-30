/**
 * The seam: everything the app takes from the career-ops engine.
 *
 * tests/seam.spec.mjs checks this declaration against the app's source and
 * tests each entry's behaviour; upstream.mjs reads it to flag a release that
 * touches any of it. Paths are relative to the engine (repo) root.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, normalize } from 'path';

export const SEAM = {
  imports: {
    'check-jd-archive.mjs': ['hasEmbeddedJdArchive'],
    'invite-match.mjs': ['analyzeInvite'],
    'lib/is-main-module.mjs': ['isMainModule'],
    'lib/walk-tree.mjs': ['listTree'],
    'path-resolver.mjs': ['getCareerOpsRoot', 'resolveTrackerPath', 'resolveTrackerPathForWrite'],
    'plugins/_engine.mjs': ['buildCtx'],
    'plugins/_net.mjs': ['resolveAndValidate'],
    'reply-matcher.mjs': ['checkCompanyMatch', 'classifyReply', 'getAppDomains', 'matchCandidates', 'normalizeStr'],
    'tracker-parse.mjs': ['detectColumns', 'parseTrackerRow', 'resolveColumns'],
    'tracker-utils.mjs': ['acquireTrackerLock', 'cell', 'trackerLockDirFor', 'writeFileAtomic'],
    'url-key.mjs': ['normalizeUrl'],
  },
  // Engine files the app runs or reads by path, through runEngine, runGate or join(ENGINE, ...).
  files: [
    'career-profile.mjs',
    'company-history.mjs',
    'merge-tracker.mjs',
    'reserve-report-num.mjs',
    'set-status.mjs',
    'templates/states.yml',
    'verify-cv-facts.mjs',
  ],
};

/**
 * The seam plus every engine module it loads, followed through relative
 * imports. A change to any of these can change what the app gets back.
 * `read(path)` returns a file's text or null, so a caller can walk a git tree.
 */
export function seamClosure(engine, read = (p) => (existsSync(join(engine, p)) ? readFileSync(join(engine, p), 'utf-8') : null)) {
  const seen = new Set();
  const queue = [...Object.keys(SEAM.imports), ...SEAM.files];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    // A path named only in a comment or an example doesn't exist, and isn't loaded.
    const text = read(path);
    if (text === null) continue;
    seen.add(path);
    if (!/\.(mjs|js)$/.test(path)) continue;
    for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const next = normalize(join(dirname(path), m[1]));
      if (!next.startsWith('..') && !next.startsWith('shukatsu/')) queue.push(next);
    }
  }
  return [...seen].sort();
}
