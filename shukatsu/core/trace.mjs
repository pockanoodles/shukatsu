/**
 * Trace resume lines back to master facts, and finalize a tailored draft.
 *
 * Two ways a line finds its fact:
 *   declared  the line carries `<!-- fact:id -->` (core/render.mjs tags every
 *             bullet it writes). The line is checked against THAT fact: it must
 *             be live, its numbers must equal the fact's, and it must still read
 *             as the same claim. A JD rewording can move every word and still pass.
 *   guessed   no tag (a hand-made resume, an old .docx). The line is matched to
 *             the most similar wording in the profile. This is for sweeping old
 *             material, not for gating new material.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { forms, isActive, isLive, numbers, numberDiff, sameNumbers, similarity, today } from './facts.mjs';
import { styleWarnings, registerMix } from '../char-count.mjs';
import { FACT_TAG, stripTags } from './render.mjs';
import { extractBullets } from '../bullet-lint.mjs';
import { readText } from '../audit-materials.mjs';

export const ENGINE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const MATCH = 0.4;   // at or above this a guessed line is that fact
export const WEAK = 0.25;   // between WEAK and MATCH a line is reported for a human look

function bestForm(p, text) {
  let best = null;
  for (const [id, { fact }] of p._facts) {
    for (const fm of forms(fact)) {
      const s = similarity(text, fm.text);
      if (!best || s > best.score) best = { id, fact, ...fm, score: Math.round(s * 100) / 100 };
    }
  }
  return best;
}

/** Map every claim-like line of a document to the fact it states, if any. */
export function trace(p, text, file = '', { bullets = false } = {}) {
  const raw = text.split('\n');
  // finalize checks achievement bullets only. A sweep of an old resume reads every
  // line long enough to carry a claim, whatever its format.
  const lines = bullets
    ? extractBullets(text, file).map((b) => ({ line: b.line, text: b.text, raw: raw[b.line - 1] || '' }))
    : raw.map((t, i) => ({ line: i + 1, raw: t, text: t.replace(/<[^>]+>/g, ' ').replace(/^\s*[-*•]\s+/u, '').trim() }))
      .filter((l) => [...l.text].length >= 25);
  return lines.map((l) => {
    const tag = l.raw.match(FACT_TAG);
    if (tag) {
      const hit = p._facts.get(tag[1]);
      if (!hit) return { line: l.line, text: l.text, kind: 'unknown', declared: true, id: tag[1], variant: tag[2] || null, score: 0, live: false, numbersOk: null };
      // A Japanese line (`/ja`) is held to the fact's confirmed Japanese wording,
      // figures and counters included, since that wording was itself reviewed
      // against the English. Any other line is held to the canonical fact.
      const isJa = tag[2] === 'ja';
      const fm = isJa ? forms(hit.fact).find((x) => x.form === 'ja')
        : forms(hit.fact).find((x) => x.form === (tag[2] ? `variant:${tag[2]}` : 'text')) || forms(hit.fact)[0];
      if (!fm) return { line: l.line, text: l.text, kind: 'unknown', declared: true, id: tag[1], variant: tag[2], score: 0, live: false, numbersOk: null, noJa: true };
      const base = isJa ? fm.text : hit.fact.text;
      const score = Math.round((isJa ? similarity(l.text, fm.text) : Math.max(...forms(hit.fact).filter((x) => x.form !== 'ja').map((x) => similarity(l.text, x.text)))) * 100) / 100;
      return {
        line: l.line, text: l.text, declared: true, id: tag[1], variant: tag[2] || null, form: fm.form, score,
        kind: score >= MATCH ? 'match' : score >= WEAK ? 'reworded' : 'drifted',
        retired: !isActive(hit.fact), live: fm.live,
        numbersOk: sameNumbers(l.text, base), expected: base,
        numberDiff: numberDiff(base, l.text),
      };
    }
    const best = bestForm(p, l.text);
    const kind = !best || best.score < WEAK ? 'unmatched' : best.score < MATCH ? 'weak' : 'match';
    return {
      line: l.line, text: l.text, declared: false, kind,
      id: kind === 'unmatched' ? null : best.id, form: best?.form, score: best?.score ?? 0,
      retired: kind === 'match' && !isActive(best.fact),
      live: kind === 'match' && best.live,
      numbersOk: kind === 'unmatched' ? null : sameNumbers(l.text, best.text),
      expected: best?.text,
      numberDiff: best ? numberDiff(best.text, l.text) : null,
    };
  });
}

/** Why a traced bullet can't go out, or null when it can. */
export function traceProblem(r) {
  const at = `line ${r.line}`;
  if (r.kind === 'unknown') return r.noJa ? `${at}: ${r.id} has no Japanese wording yet` : `${at}: declares fact ${r.id}, which the profile doesn't have`;
  if (r.kind === 'unmatched' || r.kind === 'weak') return `${at}: traces to no fact (best ${r.id || '-'} at ${r.score}). Add it to the profile or cut it: "${r.text}"`;
  if (r.retired) return `${at}: ${r.id} is no longer active: "${r.text}"`;
  if (!r.live) return `${at}: ${r.id}${r.variant ? `/${r.variant}` : ''} isn't verified yet`;
  if (r.kind === 'drifted') return `${at}: says it states ${r.id} but reads as a different claim (similarity ${r.score}). Reword closer to the fact, or propose a new fact: "${r.text}"`;
  if (!r.numbersOk) return `${at}: numbers changed from ${r.id} [${numbers(r.expected)}] to [${numbers(r.text)}]`;
  return null;
}

export function runGate(name, script, file, root) {
  const r = spawnSync(process.execPath, [join(ENGINE, script), file], {
    cwd: ENGINE, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_DATA_DIR: root },
  });
  return { name, ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

/**
 * Japanese style: the voice rules (no em dashes, semicolons, curly quotes), no
 * "co-op" (it doesn't parse for a Japanese employer), and one politeness
 * register across the document. Blocks on any of them.
 */
export function jaStyleGate(text, file = '') {
  const bullets = extractBullets(text, file);
  const issues = [];
  for (const b of bullets) for (const w of styleWarnings(b.text)) issues.push(`line ${b.line}: ${w}`);
  const reg = registerMix(bullets.map((b) => b.text).join('\n'));
  if (reg.mixed) issues.push(`mixes registers: ${reg.desumasu} です・ます endings vs ${reg.dearu} だ・である endings`);
  return { name: 'ja-style', ok: issues.length === 0, out: issues.join('\n') };
}

/** The sendable file for a draft: same name with `.final` before the extension. */
export const deliverablePath = (draft) => join(dirname(draft), `${basename(draft, extname(draft)).replace(/\.final$/, '')}.final${extname(draft)}`);

/**
 * Check a draft, write its clean deliverable, run every gate on the
 * deliverable, and record the result in the manifest. Returns the verdict;
 * nothing is "Final" unless every line traces and every gate passes.
 */
export function finalize(p, root, manifestPath, file) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const draftPath = resolve(root, file || m.output);
  if (!existsSync(draftPath)) throw new Error(`No draft at ${relative(root, draftPath)}`);
  const text = readText(draftPath);
  const rows = trace(p, text, draftPath, { bullets: true });
  const problems = rows.map(traceProblem).filter(Boolean);
  const tagged = rows.some((r) => r.declared);
  const outPath = tagged ? deliverablePath(draftPath) : draftPath;
  if (tagged) writeFileSync(outPath, stripTags(text));
  // The bullet rules are English (verb first, past tense), so a Japanese CV runs
  // the Japanese style check instead. Upstream's fact gate can't count Japanese
  // figures, which is why the declared-fact trace above carries that weight.
  const ja = m.lang === 'ja';
  const gates = [
    ja ? jaStyleGate(stripTags(text), draftPath) : runGate('bullet-lint', 'shukatsu/bullet-lint.mjs', outPath, root),
    runGate('verify-cv-facts', 'verify-cv-facts.mjs', outPath, root),
    runGate('audit', 'shukatsu/audit-materials.mjs', outPath, root),
  ];
  const ok = !problems.length && gates.every((g) => g.ok);
  const final = rows.filter((r) => r.id && r.kind !== 'unmatched' && r.kind !== 'unknown')
    .map((r) => ({ id: r.id, variant: r.variant ?? null, form: r.form, declared: r.declared, score: r.score, text: r.text }));
  // Re-checking an unchanged final draft keeps its date, so a check never reads as an edit.
  const unchanged = m.status === 'final' && JSON.stringify((m.final || []).map((x) => x.text)) === JSON.stringify(final.map((x) => x.text));
  m.output = relative(root, draftPath);
  m.deliverable = relative(root, outPath);
  m.final = final;
  m.status = ok ? 'final' : 'draft';
  m.finalized = ok ? (unchanged && m.finalized ? m.finalized : today()) : null;
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  return { ok, problems, gates, rows, deliverable: m.deliverable };
}
