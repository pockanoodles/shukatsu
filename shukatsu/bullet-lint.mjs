#!/usr/bin/env node

/**
 * Lint resume bullets against checkable writing rules.
 *
 * The upstream fact gate answers "is every claim true?" This answers "is every
 * bullet written the way a recruiter reads it?": a strong past-tense verb first,
 * a number for scope or result, two lines at most, no filler or AI vocabulary,
 * no pronouns, and the candidate's own punctuation rules. Rules a regex can't
 * judge (does the number say what it means, is it one idea) live in
 * modes/shukatsu/bullets.md, which the generator follows before this runs.
 *
 * Defaults are below. {DATA_ROOT}/config/bullet-rules.yml extends them.
 *
 * Usage:
 *   node shukatsu/bullet-lint.mjs                 # lint {DATA_ROOT}/cv.md
 *   node shukatsu/bullet-lint.mjs <file.md|.html>
 *   node shukatsu/bullet-lint.mjs <file> --json
 *   node shukatsu/bullet-lint.mjs --self-test
 *
 * Exit code: 0 no errors, 1 errors, 2 usage/config problem.
 */

import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

// Openers that describe a duty instead of an action. A bullet starting with one
// tells the reader what the job was, not what the candidate did.
const WEAK_OPENERS = [
  'responsible', 'helped', 'help', 'assisted', 'assist', 'worked', 'work', 'participated',
  'involved', 'tasked', 'duties', 'handled', 'was', 'were', 'served', 'tried', 'attempted',
  'contributed', 'supported', 'utilized', 'leveraged', 'used',
];

// humanize's core AI vocabulary plus the resume cliches recruiters skim past.
const BANNED = [
  'delve', 'leverage', 'leveraged', 'leveraging', 'utilize', 'utilized', 'utilizing', 'robust',
  'comprehensive', 'streamline', 'streamlined', 'foster', 'fostered', 'facilitate', 'facilitated',
  'pivotal', 'nuanced', 'multifaceted', 'crucial', 'garner', 'garnered', 'valuable', 'vibrant',
  'showcase', 'showcased', 'underscore', 'landscape', 'intricate', 'synergy', 'synergies',
  'spearheaded', 'spearhead', 'results-driven', 'detail-oriented', 'passionate', 'dynamic',
  'team player', 'go-getter', 'best-in-class', 'world-class', 'cutting-edge', 'state-of-the-art',
  'innovative', 'seamless', 'seamlessly', 'impactful', 'various', 'numerous', 'myriad', 'plethora',
  'successfully', 'effectively', 'actively', 'proactively', 'tirelessly', 'key role', 'instrumental',
  'thought leader', 'game-changing', 'revolutionized', 'holistic', 'empowered',
];

const HEDGES = ['helped to', 'assisted in', 'worked on', 'involved in', 'played a role', 'was part of', 'tried to', 'aimed to'];
// "I" counts only before a lowercase word ("I built") and never after a level
// word, so "CFA Level I in May" passes.
const PRONOUNS = /\b((?<!(Level|Part|Phase|Tier|Series|Class)\s)I(?=\s+[a-z])|me|my|mine|we|our|us)\b/u;

// Only achievement sections get linted. Skills, education, and certification
// lines are lists, so verb/number/length rules don't apply to them.
const ACHIEVEMENT_SECTIONS = /experience|project|volunteer|leadership|activit|経歴|職歴/iu;

// Irregular past forms that don't end in -ed, so the tense check doesn't flag them.
const IRREGULAR_PAST = new Set([
  'built', 'led', 'ran', 'won', 'wrote', 'made', 'found', 'cut', 'set', 'drove', 'grew', 'took',
  'began', 'brought', 'sold', 'taught', 'thought', 'spent', 'sent', 'held', 'kept', 'met', 'paid',
  'put', 'read', 'rebuilt', 'rewrote', 'saw', 'shipped', 'spoke', 'stood', 'told', 'understood',
  'upheld', 'withdrew', 'co-led', 'co-founded', 'overhauled', 'oversaw', 'chose', 'drew', 'flew',
  'gave', 'got', 'hired', 'laid', 'lent', 'rose', 'shot', 'split', 'struck', 'swept', 'undertook',
]);

const DEFAULTS = {
  length: { min_chars: 70, max_chars: 230 },
  punctuation: { em_dash: 'warn', semicolon: 'warn', smart_quotes: 'warn', trailing_period: 'consistent' },
  banned_extra: [],
  allow: [],
};

export function loadRules(root) {
  const path = join(root, 'config', 'bullet-rules.yml');
  const user = existsSync(path) ? (yaml.load(readFileSync(path, 'utf-8')) || {}) : {};
  return {
    length: { ...DEFAULTS.length, ...(user.length || {}) },
    punctuation: { ...DEFAULTS.punctuation, ...(user.punctuation || {}) },
    banned: [...BANNED, ...(user.banned_extra || [])],
    allow: new Set((user.allow || []).map((a) => String(a.word || a).toLowerCase())),
  };
}

const stripMarkdown = (s) => s
  .replace(/\*\*|__|`/g, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .trim();

// Walk the CV as sections: each `###` heading starts a role, and a date line
// containing Present/Current marks the role as ongoing (present tense expected).
export function extractBullets(text, file = '') {
  const lines = file.endsWith('.html')
    ? text.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '\n').replace(/<h3[^>]*>/gi, '\n### ').split('\n')
    : text.split('\n');
  const bullets = [];
  let role = { name: '(top)', current: false };
  let inScope = !/^#{1,2}\s/m.test(text);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (/^##\s/.test(line)) inScope = ACHIEVEMENT_SECTIONS.test(line);
    if (/^#{2,3}\s/.test(line)) role = { name: stripMarkdown(line.replace(/^#+\s*/, '')), current: false };
    else if (/\b(present|current)\b|現在/iu.test(line) && !/^[-*•]\s/.test(line)) role.current = true;
    const m = line.match(/^[-*•]\s+(.*)$/u);
    if (m && inScope) bullets.push({ text: stripMarkdown(m[1]), line: i + 1, role: role.name, current: role.current });
  });
  return bullets;
}

function wordHit(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z-])${escaped}([^a-z-]|$)`, 'iu').test(text);
}

export function lintBullet(b, rules) {
  const out = [];
  const add = (severity, rule, message) => out.push({ severity, rule, message });
  const t = b.text;
  const first = (t.match(/^[A-Za-z][A-Za-z-]*/u) || [''])[0].toLowerCase();

  if (!first) add('warn', 'opener', 'does not start with a verb');
  else if (WEAK_OPENERS.includes(first) && !rules.allow.has(first)) add('error', 'weak-opener', `starts with "${first}", which describes a duty instead of an action`);
  else if (!b.current && !/ed$/.test(first) && !IRREGULAR_PAST.has(first)) add('warn', 'tense', `"${first}" isn't past tense, but the role has ended`);

  const len = [...t].length;
  if (len > rules.length.max_chars) add('error', 'length', `${len} chars, over the ${rules.length.max_chars} two-line budget by ${len - rules.length.max_chars}`);
  else if (len < rules.length.min_chars) add('warn', 'length', `${len} chars, thin (under ${rules.length.min_chars})`);

  if (!/\d/.test(t)) add('warn', 'no-number', 'no number for scope or result');

  for (const word of rules.banned) {
    if (!rules.allow.has(word.toLowerCase()) && wordHit(t, word)) add('error', 'banned', `"${word}"`);
  }
  for (const h of HEDGES) if (t.toLowerCase().includes(h)) add('error', 'hedge', `"${h}" softens the action`);
  const pron = t.match(PRONOUNS);
  if (pron) add('error', 'pronoun', `"${pron[0]}" (resumes drop the subject)`);

  const p = rules.punctuation;
  if (p.em_dash !== 'off' && /—|--|\s–\s|(?<!\d)–|–(?!\d)/u.test(t)) add(p.em_dash, 'em-dash', 'em/en dash outside a numeric range')
  if (p.semicolon !== 'off' && /;/.test(t)) add(p.semicolon, 'semicolon', 'semicolon (split it or join with a connector)');
  // Voice rule: no colon introducing parallel clauses ("X: A, B, and C").
  const afterColon = t.split(/:\s/u).slice(1).join(' ');
  if (afterColon && (afterColon.match(/,/g) || []).length >= 2) add('warn', 'colon-list', 'colon followed by a list of clauses (say why each piece matters, or cut to the strongest)');
  if (p.smart_quotes !== 'off' && /[“”]/u.test(t)) add(p.smart_quotes, 'smart-quotes', 'curly quotes');
  return out;
}

export function lintText(text, file, rules) {
  const bullets = extractBullets(text, file);
  const results = bullets.map((b) => ({ ...b, findings: lintBullet(b, rules) }));

  // Document-level rules: repeated openers and inconsistent end punctuation.
  const byRole = new Map();
  const counts = new Map();
  for (const r of results) {
    const verb = (r.text.match(/^[A-Za-z-]+/u) || [''])[0].toLowerCase();
    if (!verb) continue;
    const key = `${r.role}::${verb}`;
    if (byRole.has(key)) r.findings.push({ severity: 'warn', rule: 'repeat-opener', message: `"${verb}" already opens a bullet in this role (line ${byRole.get(key)})` });
    else byRole.set(key, r.line);
    counts.set(verb, (counts.get(verb) || 0) + 1);
  }
  for (const r of results) {
    const verb = (r.text.match(/^[A-Za-z-]+/u) || [''])[0].toLowerCase();
    if (verb && counts.get(verb) > 2) r.findings.push({ severity: 'warn', rule: 'overused-verb', message: `"${verb}" opens ${counts.get(verb)} bullets in the document` });
  }
  if (rules.punctuation.trailing_period === 'consistent' && results.length > 1) {
    const withPeriod = results.filter((r) => /\.$/.test(r.text)).length;
    if (withPeriod && withPeriod !== results.length) {
      const minority = withPeriod * 2 < results.length;
      for (const r of results) if (/\.$/.test(r.text) === minority) r.findings.push({ severity: 'warn', rule: 'trailing-period', message: `${withPeriod}/${results.length} bullets end with a period; make them consistent` });
    }
  }
  return results;
}

function report(results, label) {
  let errors = 0;
  let warns = 0;
  let clean = 0;
  for (const r of results) {
    if (!r.findings.length) { clean++; continue; }
    console.log(`\nline ${r.line} · ${r.role}`);
    console.log(`  ${r.text.length > 110 ? r.text.slice(0, 107) + '...' : r.text}`);
    for (const f of r.findings) {
      if (f.severity === 'error') errors++; else warns++;
      console.log(`    ${f.severity.padEnd(5)} ${f.rule}: ${f.message}`);
    }
  }
  console.log(`\n${label}: ${results.length} bullets, ${clean} clean, ${errors} errors, ${warns} warnings`);
  return errors;
}

function selfTest() {
  const rules = { ...loadRules('/nonexistent'), punctuation: { ...DEFAULTS.punctuation, em_dash: 'error', semicolon: 'error' } };
  const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } };
  const has = (t, rule, current = false) => lintBullet({ text: t, current }, rules).some((f) => f.rule === rule);
  assert(has('Responsible for managing the CRM across 4 regions and 12 sales reps for the team', 'weak-opener'), 'weak opener');
  assert(has('Built a pipeline that leveraged 3 data sources to rank 314 leads for the sales team', 'banned'), 'banned word');
  assert(has('Built a dashboard — used by 8 people across the sales team every single week', 'em-dash'), 'em dash');
  assert(!has('Scaled outbound from 30–350 dials a day by driving two dialer migrations for the team', 'em-dash'), 'numeric range allowed');
  assert(has('Build a dashboard used by 8 people across the sales team every single week', 'tense'), 'tense for ended role');
  assert(!has('Led a team of 4 students designing prosthetics delivered to 12 amputees abroad', 'tense'), 'irregular past ok');
  assert(has('Built a tool that ranked leads for the sales team so that reps could call the best ones', 'no-number'), 'no number');
  assert(has('Built it; then shipped it to 8 users across the sales floor for the whole team', 'semicolon'), 'semicolon');
  assert(!has('Passed CFA Level I in May 2027 after 300 hours of study across 10 topic areas', 'pronoun'), 'Level I is not a pronoun');
  assert(has('Built a router for 3 models: every call logged, scored on outcomes, and replayable', 'colon-list'), 'colon list');
  assert(has('Built my own tracker for 8 reps across the sales floor and the onboarding team', 'pronoun'), 'pronoun');
  const doc = lintText('## Experience\n### A\nMay 2025 – July 2025\n- Built x for 8 reps across the whole sales floor team today.\n- Built y for 9 reps across the whole sales floor team today\n', 'a.md', rules);
  assert(doc[1].findings.some((f) => f.rule === 'repeat-opener'), 'repeat opener');
  assert(doc.some((r) => r.findings.some((f) => f.rule === 'trailing-period')), 'trailing period consistency');
  console.log('bullet-lint self-test passed');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); process.exit(0); }
  const root = getCareerOpsRoot();
  let rules;
  try { rules = loadRules(root); } catch (err) { console.error(`bullet-lint: ${err.message}`); process.exit(2); }
  const file = args.find((a) => !a.startsWith('--')) || join(root, 'cv.md');
  if (!existsSync(file)) { console.error(`bullet-lint: no such file ${file}`); process.exit(2); }
  const results = lintText(readFileSync(file, 'utf-8'), file, rules);
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0);
  }
  process.exit(report(results, relative(process.cwd(), file) || file) ? 1 : 0);
}
