/**
 * Validate the master profile: IDs, tags, statuses, evidence, number parity
 * between a fact and its other wordings, the bullet rules, and cv.md drift.
 *
 * Errors block (a verified fact that can't be backed, a variant whose numbers
 * differ). Warnings are for a human look (a draft that breaks a bullet rule,
 * evidence that moved, a Japanese text whose counters read differently).
 */

import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { extname, isAbsolute, join, relative, resolve } from 'path';
import {
  BULLET_SECTIONS, FACT_STATUS, PROVENANCE, forms, isActive, isLive, isVerified, jaNumberDiff, quantities, sameJaNumbers, sameNumbers, statusOf,
} from './facts.mjs';
import { render, withBanner } from './render.mjs';
import { ENGINE } from './trace.mjs';
import { lintBullet, loadRules } from '../bullet-lint.mjs';
import { readText } from '../audit-materials.mjs';

const inside = (root, path) => !relative(root, path).startsWith('..') && !isAbsolute(relative(root, path));

function checkEvidence(root, ev, where, verified, errors, warns) {
  if (!ev?.source) return;
  const path = isAbsolute(ev.source) ? ev.source : resolve(root, ev.source);
  const push = verified ? errors : warns;
  if (!existsSync(path)) {
    // Evidence outside the data root (the vault, another repo) exists on the
    // machine it was written on and nowhere else. On a server it can't be
    // checked, and that is not the fact's fault.
    if (!inside(root, path)) warns.push(`${where}: evidence is outside the data root and not on this machine (${ev.source}), so it wasn't checked`);
    else push.push(`${where}: evidence source missing (${ev.source})`);
    return;
  }
  if (!ev.quote) return;
  const text = readText(path);
  if (extname(path).toLowerCase() === '.docx' || !Number.isInteger(ev.line)) {
    if (!text.includes(ev.quote)) push.push(`${where}: quote not found in ${ev.source}`);
    return;
  }
  const lines = text.split('\n');
  if ((lines[ev.line - 1] || '').includes(ev.quote)) return;
  const at = lines.findIndex((l) => l.includes(ev.quote));
  if (at >= 0) warns.push(`${where}: evidence moved to ${ev.source}:${at + 1} (says line ${ev.line})`);
  else push.push(`${where}: quote not found in ${ev.source}`);
}

function checkDecision(x, where, errors, allowRetired) {
  const s = statusOf(x);
  if (!FACT_STATUS.has(s) || (!allowRetired && s === 'retired')) errors.push(`${where}: status "${s}" is not one of ${[...FACT_STATUS].filter((v) => allowRetired || v !== 'retired').join(', ')}`);
  if (s === 'retired' && (!x.retired_on || !x.reason)) errors.push(`${where}: a retired fact needs retired_on and reason`);
  if (s === 'rejected' && (!x.decided_on || !x.decision_note)) errors.push(`${where}: a rejected draft needs decided_on and decision_note`);
  if (s === 'cannot-confirm' && !x.decided_on) errors.push(`${where}: cannot-confirm needs decided_on`);
}

export function validate(p, root) {
  const errors = [];
  const warns = [];
  const vocab = new Set(p.tag_vocabulary || []);
  const archetypes = new Set(Object.keys(p.archetypes || {}));
  for (const a of Object.values(p.archetypes || {})) for (const t of a.tags) if (!vocab.has(t)) errors.push(`archetype tag "${t}" is not in tag_vocabulary`);
  const rules = loadRules(root);
  const ids = new Set();
  const checkId = (id, where) => {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(id || '')) errors.push(`${where}: id "${id}" must be lowercase dotted words`);
    if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    ids.add(id);
  };

  for (const e of p._entities) {
    checkId(e.id, e.id);
    checkDecision(e, e.id, errors, false);
    for (const t of e.tags || []) if (!vocab.has(t)) errors.push(`${e.id}: tag "${t}" is not in tag_vocabulary`);
    checkEvidence(root, e.evidence, e.id, isVerified(e) && isActive(e), errors, warns);
  }
  for (const [id, { fact: f, entity: e, kind }] of p._facts) {
    checkId(id, id);
    if (e && !id.startsWith(`${e.id}.`)) errors.push(`${id}: fact ids start with their entity id (${e.id}.)`);
    if (f.provenance && !PROVENANCE.has(f.provenance)) errors.push(`${id}: provenance "${f.provenance}" is not one of V M U T E C ?`);
    if (kind === 'bullet' && !f.provenance) errors.push(`${id}: provenance is required`);
    for (const t of f.tags || []) if (!vocab.has(t)) errors.push(`${id}: tag "${t}" is not in tag_vocabulary`);
    checkDecision(f, id, errors, true);
    checkEvidence(root, f.evidence, id, isLive(f), errors, warns);

    for (const v of f.variants || []) {
      if (!v.key) errors.push(`${id}: a variant needs a key`);
      checkDecision(v, `${id}/${v.key}`, errors, false);
      for (const a of v.for || []) if (!archetypes.has(a)) errors.push(`${id}/${v.key}: unknown archetype "${a}"`);
      if (isActive(v) && !sameNumbers(v.text, f.text)) errors.push(`${id}/${v.key}: numbers [${quantities(v.text)}] differ from the fact's [${quantities(f.text)}]`);
    }
    if (f.ja?.text) {
      checkDecision(f.ja, `${id}/ja`, errors, false);
      // Japanese counters (2件, 1回) and merged bullets make an exact match too
      // strict, so a JA mismatch is a warning to eyeball, not an error.
      if (isActive(f.ja) && !sameJaNumbers(f.text, f.ja.text)) {
        const d = jaNumberDiff(f.text, f.ja.text);
        warns.push(`${id}/ja: numbers differ from the fact's (Japanese adds [${d.added}], drops [${d.removed}])`);
      }
    }
    if (kind === 'bullet' && isActive(f) && BULLET_SECTIONS.has(e.section)) {
      for (const fm of forms(f).filter((x) => x.form !== 'ja')) {
        for (const r of lintBullet({ text: fm.text, current: e.ended === false }, rules)) {
          const msg = `${id}${fm.form === 'text' ? '' : `/${fm.form}`}: ${r.rule} -- ${r.message}`;
          (r.severity === 'error' && fm.live ? errors : warns).push(msg);
        }
      }
    }
  }

  const cvPath = join(root, 'cv.md');
  if (existsSync(cvPath) && readFileSync(cvPath, 'utf-8') !== withBanner(render(p).text)) {
    warns.push('cv.md differs from the profile render (hand-edited, or the profile changed). Run: render --write');
  }
  return { errors, warns };
}

/** Upstream's own schema check (career-ops Master Career Profile v1). */
export function upstreamValidate(path) {
  const r = spawnSync(process.execPath, [join(ENGINE, 'career-profile.mjs'), 'validate', path], { cwd: ENGINE, encoding: 'utf-8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

/** Bullet-rule findings for one wording, for live feedback while editing. */
export function lintWording(root, text, { current = false } = {}) {
  return lintBullet({ text, current }, loadRules(root));
}
