/**
 * The one write path into the master profile.
 *
 * Every change (accepting a draft, applying a proposal, retiring a fact) runs
 * as a transaction: take the lock, splice the edits into the YAML text, parse
 * and validate the result, and only if it introduces no new error write the
 * profile, append the review log, re-render cv.md, and commit all three to the
 * data root's history with who decided and who proposed.
 *
 * The review log (sources/review-log.md) is the evidence for anything the
 * candidate states or confirms in review. A fact added or re-numbered there
 * points its `evidence` at its own log line, which satisfies the upstream
 * schema (source + line + quote) with a real, tracked artifact.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { ENTITY_KEYS, LIST_KEYS, loadProfile, profilePath, today } from './facts.mjs';
import { render, withBanner } from './render.mjs';
import { upstreamValidate, validate } from './validate.mjs';
import { appendItem, deleteKey, setKey } from './yaml-edit.mjs';
import { stateDir, withLock, writeAtomic } from './lock.mjs';
import { commitPaths } from './git.mjs';

export const REVIEW_LOG = 'sources/review-log.md';
const LOG_HEADER = `# Review log

Every claim confirmed in shukatsu's review, one line each, append-only. A fact whose
\`evidence\` points here was stated or confirmed by the candidate in review, and this
line is that evidence. Written by shukatsu/core/profile-edit.mjs; don't edit by hand.

`;

/** YAML path to an entity, a fact, a variant, or a fact's Japanese text. */
export function pathOf(p, id, part = null) {
  for (const key of ENTITY_KEYS) {
    const list = p[key] || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.id === id) return [key, i];
      const j = (e.facts || []).findIndex((f) => f.id === id);
      if (j !== -1) return withPart(p, [key, i, 'facts', j], e.facts[j], part);
    }
  }
  for (const key of LIST_KEYS) {
    const i = (p[key] || []).findIndex((f) => f.id === id);
    if (i !== -1) return withPart(p, [key, i], p[key][i], part);
  }
  throw new Error(`No entity or fact "${id}" in the profile`);
}

function withPart(p, path, fact, part) {
  if (!part) return path;
  if (part === 'ja') {
    if (!fact.ja) throw new Error(`${fact.id} has no Japanese text`);
    return [...path, 'ja'];
  }
  const k = (fact.variants || []).findIndex((v) => v.key === part);
  if (k === -1) throw new Error(`${fact.id} has no variant "${part}"`);
  return [...path, 'variants', k];
}

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Run `apply(tx)` against the profile and commit the result.
 *
 * tx.p            the parsed profile before any edit
 * tx.path(id, part?)
 * tx.set(path, key, value) / tx.unset(path, key) / tx.append(path, obj)
 * tx.state(text)  record a statement in the review log, returns evidence for it
 *
 * Returns {changed, commit, errors}. Throws, writing nothing, when the edit
 * would add a validation error.
 */
export function editProfile(root, { actor, proposedBy = null, message, apply }) {
  return withLock(root, 'profile', () => {
    const file = profilePath(root);
    const before = readFileSync(file, 'utf-8');
    const p = loadProfile(root, before);
    let text = before;
    const logLines = [];
    const logPath = join(root, REVIEW_LOG);
    // Normalized to end in exactly one newline, so line numbers match what's written.
    const logText = (existsSync(logPath) ? readFileSync(logPath, 'utf-8') : LOG_HEADER).replace(/\n*$/, '\n');
    const baseLine = logText.split('\n').length - 1;

    const tx = {
      p,
      path: (id, part) => pathOf(p, id, part),
      set: (path, key, value) => { text = setKey(text, path, key, value); },
      unset: (path, key) => { text = deleteKey(text, path, key); },
      append: (path, obj) => { text = appendItem(text, path, obj); },
      state: (statement) => {
        const by = actor?.name || 'candidate';
        const from = proposedBy && proposedBy.id !== actor?.id ? ` · proposed by ${proposedBy.name}` : '';
        const clean = String(statement).replace(/\s+/g, ' ').trim();
        logLines.push(`- ${today()} · confirmed by ${by}${from} · ${clean}`);
        return { source: REVIEW_LOG, line: baseLine + logLines.length, quote: clean };
      },
    };
    apply(tx);
    if (text === before && !logLines.length) return { changed: false, commit: null, errors: [] };

    const after = loadProfile(root, text);
    const was = new Set(validate(p, root).errors);
    // The review log line a new fact cites doesn't exist until it's written, so
    // its evidence check is the one error allowed to be "new" here.
    const added = validate(after, root).errors.filter((e) => !was.has(e) && !(logLines.length && e.includes(REVIEW_LOG)));
    // Upstream's schema check reads a file, so give it the candidate text.
    const probe = join(stateDir(root), 'tmp', 'career-profile.check.yml');
    mkdirSync(dirname(probe), { recursive: true });
    writeAtomic(probe, text);
    const upstream = upstreamValidate(probe);
    if (!upstream.ok && upstreamValidate(file).ok) added.push(`upstream schema: ${upstream.out}`);
    if (added.length) {
      const err = new Error(`That change would break the profile:\n${added.map((e) => `  ${e}`).join('\n')}`);
      err.errors = added;
      throw err;
    }

    writeAtomic(file, text);
    const touched = [relative(root, file)];
    if (logLines.length) {
      mkdirSync(dirname(logPath), { recursive: true });
      writeAtomic(logPath, `${logText}${logLines.join('\n')}\n`);
      touched.push(REVIEW_LOG);
    }
    const cvPath = join(root, 'cv.md');
    const cv = withBanner(render(after).text);
    if (!existsSync(cvPath) || readFileSync(cvPath, 'utf-8') !== cv) {
      writeAtomic(cvPath, cv);
      touched.push('cv.md');
    }
    const commit = commitPaths(root, touched, message, {
      author: actor,
      trailers: { 'Proposed-by': proposedBy && proposedBy.id !== actor?.id ? proposedBy.name : null, 'Via': 'shukatsu review' },
    });
    return { changed: true, commit, touched, errors: [] };
  });
}

export { short };
