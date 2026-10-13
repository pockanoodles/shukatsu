/**
 * An evaluation report, written the way modes/oferta.md specifies and
 * enforced in code instead of asked of whoever writes it.
 *
 * The caller (an agent, usually) supplies the judgment: the blocks, the
 * score, the legitimacy tier, the machine summary, and the job description.
 * This module owns everything that must not be left to memory:
 *
 *   - the report number, reserved through reserve-report-num.mjs (#749)
 *   - the header, in oferta.md's order, with **URL:** and **Legitimacy:**
 *   - the machine summary, with the fields that must agree with the header
 *     (company, role, score, tier) filled from it so they can't disagree
 *   - the archived JD, checked with check-jd-archive.mjs's own rule (#2789)
 *   - the tracker row, as a headed TSV merged by merge-tracker.mjs, which
 *     updates an existing company+role row instead of adding a second one
 *
 * A missing block is an error naming the block.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { hasEmbeddedJdArchive } from '../../check-jd-archive.mjs';
import { readTracker, runEngine, ensureTracker } from './tracker.mjs';
import { slug, today } from './facts.mjs';

export const LEGITIMACY = ['High Confidence', 'Proceed with Caution', 'Suspicious'];
export const WORK_AUTH = { sponsors: '✅ Sponsors', not_needed: '➖ Not needed', unstated: '⚠️ Unstated', no_sponsorship: '⛔ No sponsorship' };
export const FINAL_DECISIONS = ['Apply', 'Consider', 'Research first', 'Skip'];

/** The blocks every report carries, in order, with the heading each gets. */
export const BLOCKS = [
  ['a', 'A) Role Summary'],
  ['b', 'B) Match with CV'],
  ['c', 'C) Level and Strategy'],
  ['d', 'D) Comp and Demand'],
  ['e', 'E) Customization Plan'],
  ['f', 'F) Interview Plan'],
  ['g', 'G) Posting Legitimacy'],
  ['risk_summary', 'Risk Summary'],
  ['score_evidence', 'Score Evidence'],
];
const OPTIONAL = [['h', 'H) Draft Application Answers'], ['keywords', 'Keywords extracted']];

const tierKey = (t) => t.toLowerCase().replace(/\s+/g, '_');
const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Problems with an evaluation before anything is written, as sentences naming what's missing. */
export function evaluationProblems(ev) {
  const out = [];
  for (const [key, heading] of BLOCKS) {
    if (!String(ev.blocks?.[key] || '').trim()) out.push(`Block "${heading}" is missing (blocks.${key}).`);
  }
  if (ev.score >= 4.5 && !String(ev.blocks?.h || '').trim()) out.push('A score of 4.5 or more needs block "H) Draft Application Answers" (blocks.h).');
  const ms = ev.machine_summary || {};
  if (!('advertised_comp' in ms)) out.push('machine_summary.advertised_comp is required: the JD\'s own salary text verbatim, or null when it states none.');
  if (!ms.risk_summary || typeof ms.risk_summary !== 'object') out.push('machine_summary.risk_summary is required (the Risk Summary block as a map).');
  else if (ms.risk_summary.legitimacy && ms.risk_summary.legitimacy !== tierKey(ev.legitimacy)) {
    out.push(`machine_summary.risk_summary.legitimacy is "${ms.risk_summary.legitimacy}" but the header tier is "${ev.legitimacy}".`);
  }
  if (!Array.isArray(ms.requirement_importance)) out.push('machine_summary.requirement_importance is required (Block B\'s table row by row, [] when the JD has no usable list).');
  for (const [i, r] of (ms.requirement_importance || []).entries()) {
    if (r?.evidence === 'stated' && !r.jd_signal) out.push(`requirement_importance[${i}] is "stated" but has no verbatim jd_signal.`);
    if (r?.evidence === 'inferred' && ['critical', 'high'].includes(r.importance)) out.push(`requirement_importance[${i}] is inferred, so its importance can't be ${r.importance} (Block B's gate).`);
  }
  if (ms.final_decision && !FINAL_DECISIONS.includes(ms.final_decision)) out.push(`machine_summary.final_decision must be one of ${FINAL_DECISIONS.join(', ')}.`);
  return out;
}

/** The report's markdown, exactly in oferta.md's layout. */
export function renderReport(ev, { num, date }) {
  const summary = {
    company: ev.company, role: ev.role, score: ev.score, legitimacy_tier: ev.legitimacy, archetype: ev.archetype,
    ...ev.machine_summary,
    via: ev.via || null,
    work_auth: ev.work_auth || ev.machine_summary?.work_auth || 'unstated',
  };
  summary.risk_summary = { ...summary.risk_summary, legitimacy: tierKey(ev.legitimacy) };
  const lines = [
    `# Evaluation: ${ev.company} — ${ev.role}`,
    '',
    `**Date:** ${date}`,
    `**URL:** ${ev.url}`,
    `**Via:** ${ev.via || '—'}`,
    `**Archetype:** ${ev.archetype}`,
    `**Score:** ${ev.score.toFixed(1)}/5`,
    `**Legitimacy:** ${ev.legitimacy}`,
    `**Work Auth:** ${WORK_AUTH[summary.work_auth] || WORK_AUTH.unstated}`,
    `**PDF:** ${ev.pdf || 'pending'}`,
    ...(ev.verification ? [`**Verification:** ${ev.verification}`] : []),
    '',
    '---',
    '',
    '## Machine Summary',
    '',
    '```yaml',
    yaml.dump(summary, { lineWidth: 120, noRefs: true }).trimEnd(),
    '```',
    '',
  ];
  for (const [key, heading] of [...BLOCKS, OPTIONAL[0]]) {
    const body = String(ev.blocks?.[key] || '').trim();
    if (!body) continue;
    lines.push(`## ${heading}`, '', body, '');
  }
  lines.push('---', '');
  if (String(ev.blocks?.keywords || '').trim()) lines.push('## Keywords extracted', '', ev.blocks.keywords.trim(), '');
  lines.push('## Job Description (archived verbatim)', '', ev.jdText.trim(), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

/** Report numbers already on disk, so a reserved number is checked against reality too. */
const reportFor = (root, num) => {
  const dir = join(root, 'reports');
  if (!existsSync(dir)) return null;
  const pad = String(num).padStart(3, '0');
  return readdirSync(dir).find((f) => f.startsWith(`${pad}-`) && f.endsWith('.md') && !f.endsWith('-RESERVED.md')) || null;
};

/** The JD text a capture reference points at (local:jds/file), for an evaluation built on a capture. */
export function captureText(root, ref) {
  const m = String(ref || '').match(/^local:jds\/([\w.\-]+)$/);
  if (!m) throw new Error('jd_capture must look like local:jds/{file}, as posting.capture returns it.');
  const path = join(root, 'jds', m[1]);
  if (!existsSync(path)) throw new Error(`There's no capture at jds/${m[1]}.`);
  return readFileSync(path, 'utf-8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/**
 * Write one evaluation: report file, tracker row. Returns { num, report, tracker }.
 * Throws with every problem at once when the evaluation is incomplete.
 */
export function submitEvaluation(root, ev) {
  const jdText = ev.jd_text?.trim() || (ev.jd_capture ? captureText(root, ev.jd_capture) : '');
  const full = { ...ev, jdText };
  const problems = evaluationProblems(full);
  const date = ev.date || today();
  const probe = renderReport(full, { num: 0, date });
  if (!hasEmbeddedJdArchive(probe)) problems.push('The archived job description is missing or too thin: pass the posting\'s full text verbatim as jd_text, or a capture as jd_capture.');
  if (problems.length) throw Object.assign(new Error(`The evaluation isn't complete:\n- ${problems.join('\n- ')}`), { code: 'evaluation.incomplete', details: problems });

  const reserved = runEngine('reserve-report-num.mjs', ['--count', '1'], root);
  const num = Number((reserved.out.match(/\b(\d{3,})\b/) || [])[1]);
  if (!reserved.ok || !num) throw new Error(`Couldn't reserve a report number: ${reserved.out.split('\n').slice(-2).join(' ')}`);
  try {
    if (reportFor(root, num)) throw new Error(`Report ${num} already exists on disk; the reservation and the files disagree.`);
    const pad = String(num).padStart(3, '0');
    const file = `${pad}-${slug(ev.company)}-${date}.md`;
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(join(root, 'reports', file), renderReport(full, { num, date }));

    ensureTracker(root);
    const dir = join(root, 'batch', 'tracker-additions');
    mkdirSync(dir, { recursive: true });
    const header = ['num', 'date', 'company', 'role', 'status', 'score', 'pdf', 'report', 'notes', 'url', ...(ev.via ? ['via'] : []), ...(ev.location ? ['location'] : [])];
    const row = [num, date, ev.company, ev.role, ev.status || 'Evaluated', `${ev.score.toFixed(1)}/5`, ev.pdf ? '✅' : '❌', `[${pad}](reports/${file})`,
      ev.notes || '', ev.url, ...(ev.via ? [ev.via] : []), ...(ev.location ? [ev.location] : [])].map(cell);
    writeFileSync(join(dir, `${pad}-${slug(ev.company)}.tsv`), `${header.join('\t')}\n${row.join('\t')}\n`);
    const merged = runEngine('merge-tracker.mjs', [], root);
    const rows = readTracker(root).rows;
    const landed = rows.find((r) => r.num === num) || rows.find((r) => String(r.report || '').includes(file));
    if (!merged.ok || !landed) throw new Error(`The report is written (reports/${file}) but the tracker merge didn't land it: ${merged.out.split('\n').slice(-3).join(' ')}`);
    return { num: landed.num, report: `reports/${file}`, tracker: { num: landed.num, status: landed.status, merged_into_existing: landed.num !== num } };
  } finally {
    runEngine('reserve-report-num.mjs', ['--release', String(num)], root);
  }
}

/** A report by number: its file, header fields, and the archived JD. */
export function readReport(root, num) {
  const file = reportFor(root, num);
  if (!file) return null;
  const text = readFileSync(join(root, 'reports', file), 'utf-8');
  const field = (k) => (text.match(new RegExp(`^\\*\\*${k}:\\*\\*\\s*(.*)$`, 'm')) || [])[1]?.trim() || null;
  const jd = (text.match(/^## Job Description[^\n]*\n([\s\S]*)$/m) || [])[1]?.trim() || null;
  return {
    num, file: `reports/${file}`, url: field('URL'), score: field('Score'), legitimacy: field('Legitimacy'), archetype: field('Archetype'),
    date: field('Date'), body: jd ? text.slice(0, text.indexOf('## Job Description')).trim() : text, jd,
  };
}
