#!/usr/bin/env node

/**
 * Audit every employer-facing document for claims that are false, retired, or
 * missing.
 *
 * The upstream fact gate (verify-cv-facts.mjs) checks one freshly generated CV.
 * Materials that already went out, or were written by hand (.docx resumes,
 * CFN paste text, 履歴書), never pass through it, so a claim retired in the
 * source of truth keeps living in them. This sweeps all of them in one pass,
 * against the same forbidden phrases plus a list of facts each resume must
 * carry, and flags documents older than the sources they were built from.
 *
 * Rules: {DATA_ROOT}/config/materials-audit.yml, plus forbidden_phrases from
 * {DATA_ROOT}/config/cv-facts.json.
 *
 * Usage:
 *   node shukatsu/audit-materials.mjs            # scan the configured dirs
 *   node shukatsu/audit-materials.mjs <file|dir>  # scan specific paths
 *   node shukatsu/audit-materials.mjs --json
 *
 * Exit code: 0 clean, 1 at least one error, 2 config problem.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { basename, extname, isAbsolute, join, relative } from 'path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { listTree } from '../lib/walk-tree.mjs';
import { printUsage } from './core/usage.mjs';

const READABLE = new Set(['.md', '.txt', '.html', '.docx']);

export function loadRules(root) {
  const auditPath = join(root, 'config', 'materials-audit.yml');
  if (!existsSync(auditPath)) throw new Error(`missing ${auditPath}`);
  const rules = yaml.load(readFileSync(auditPath, 'utf-8')) || {};
  const factsPath = join(root, 'config', 'cv-facts.json');
  const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, 'utf-8')) : {};
  return {
    scan: rules.scan || ['current/', 'output/'],
    forbiddenPhrases: (facts.forbidden_phrases || []).filter(Boolean),
    forbiddenPatterns: (rules.forbidden_patterns || []).map((r) => ({ ...r, re: new RegExp(r.pattern, 'iu') })),
    required: (rules.required || []).map((r) => ({ severity: 'error', ...r, re: new RegExp(r.pattern, 'iu') })),
    staleAgainst: rules.stale_against || [],
  };
}

// .docx is a zip; word/document.xml holds the body. unzip ships with macOS and
// most Linux images, which avoids pulling a zip library in for one read.
export function readText(path) {
  if (extname(path).toLowerCase() !== '.docx') return readFileSync(path, 'utf-8');
  const xml = execFileSync('unzip', ['-p', path, 'word/document.xml'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Resume vs. other material decides which `required` rules apply; language
// decides the availability phrasing. Both come from the filename and the text,
// since the filenames here are hand-written and inconsistent.
export function classify(path, text) {
  const name = basename(path).toLowerCase();
  const isResume = /resume|履歴書|rirekisho|\bcv\b|cv[-_ ]/iu.test(name);
  const kana = (text.match(/[぀-ヿ]/gu) || []).length;
  const lang = kana > text.length * 0.05 ? 'ja' : 'en';
  return { isResume, lang };
}

function appliesTo(rule, kind) {
  if (rule.applies_to === 'resume') return kind.isResume;
  if (rule.applies_to === 'resume-en') return kind.isResume && kind.lang === 'en';
  if (rule.applies_to === 'resume-ja') return kind.isResume && kind.lang === 'ja';
  return true;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function auditText(text, kind, rules) {
  const findings = [];
  const lower = text.toLowerCase();
  for (const phrase of rules.forbiddenPhrases) {
    const at = lower.indexOf(String(phrase).toLowerCase());
    if (at !== -1) findings.push({ severity: 'error', kind: 'forbidden', what: phrase, line: lineOf(text, at), reason: 'cv-facts.json forbidden_phrases' });
  }
  // A phrase and a pattern often catch the same claim; report it once, keeping
  // the pattern's reason since it says why the claim is wrong.
  for (const rule of rules.forbiddenPatterns) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const line = lineOf(text, m.index);
    const dupe = findings.findIndex((f) => f.kind === 'forbidden' && f.line === line);
    if (dupe !== -1) findings.splice(dupe, 1);
    findings.push({ severity: 'error', kind: 'forbidden', what: m[0], line, reason: rule.reason });
  }
  if (kind.lang === 'ja') {
    const m = /co-?op|コープ|コーオプ/iu.exec(text);
    if (m) findings.push({ severity: 'warn', kind: 'wording', what: m[0], line: lineOf(text, m.index), reason: '"co-op" does not parse for a Japanese employer; say 長期インターンシップ and give its dates' });
  }
  for (const rule of rules.required) {
    if (appliesTo(rule, kind) && !rule.re.test(text)) {
      findings.push({ severity: rule.severity, kind: 'missing', what: rule.id, reason: rule.reason });
    }
  }
  return findings;
}

// Links are followed, as statSync did before, since a materials folder may link to documents kept elsewhere.
function walk(path) {
  if (!existsSync(path)) return [];
  const readable = (p) => {
    const name = basename(p);
    return READABLE.has(extname(name).toLowerCase()) && !name.startsWith('~$') && !name.startsWith('.');
  };
  return (statSync(path).isFile() ? [path] : listTree(path, { links: 'follow' })).filter(readable);
}

export function audit(root, targets) {
  const rules = loadRules(root);
  const sources = rules.staleAgainst.map((p) => join(root, p)).filter(existsSync);
  const newestSource = sources.length ? Math.max(...sources.map((p) => statSync(p).mtimeMs)) : 0;
  const files = (targets.length ? targets : rules.scan)
    .map((p) => (isAbsolute(p) ? p : join(root, p)))
    .flatMap((p) => walk(p));
  return files.map((file) => {
    let text;
    try {
      text = readText(file);
    } catch (err) {
      return { file, kind: null, findings: [{ severity: 'error', kind: 'unreadable', what: err.message.split('\n')[0] }] };
    }
    const kind = classify(file, text);
    const findings = auditText(text, kind, rules);
    if (newestSource && statSync(file).mtimeMs < newestSource) {
      findings.push({ severity: 'warn', kind: 'stale', what: 'older than cv.md / article-digest.md', reason: 'regenerate from the current sources before reuse' });
    }
    return { file, kind, findings };
  });
}

function report(results, root) {
  let errors = 0;
  let warns = 0;
  for (const { file, kind, findings } of results) {
    const rel = relative(root, file);
    const tag = kind ? `${kind.isResume ? 'resume' : 'material'}/${kind.lang}` : '?';
    if (!findings.length) { console.log(`✓ ${rel}  (${tag})`); continue; }
    const bad = findings.some((f) => f.severity === 'error');
    console.log(`${bad ? '✗' : '⚠'} ${rel}  (${tag})`);
    for (const f of findings) {
      if (f.severity === 'error') errors++; else warns++;
      const where = f.line ? ` line ${f.line}` : '';
      console.log(`    ${f.severity.padEnd(5)} ${f.kind}: ${f.what}${where}`);
      if (f.reason) console.log(`          ${f.reason}`);
    }
  }
  console.log(`\n${results.length} documents, ${errors} errors, ${warns} warnings`);
  return errors;
}

if (isMainModule(import.meta.url) && ['--help', '-h'].some((f) => process.argv.includes(f))) {
  printUsage(import.meta.url);
} else if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = getCareerOpsRoot();
  let results;
  try {
    results = audit(root, args.filter((a) => !a.startsWith('--')));
  } catch (err) {
    console.error(`audit-materials: ${err.message}`);
    process.exit(2);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0);
  }
  process.exit(report(results, root) ? 1 : 0);
}
