#!/usr/bin/env node

/**
 * leak-check.mjs -- keep the candidate's own material out of this public repo.
 *
 *   node shukatsu/leak-check.mjs            every tracked file the fork writes
 *   node shukatsu/leak-check.mjs --staged   the lines a commit is about to add (the pre-commit hook)
 *   node shukatsu/leak-check.mjs --history  every line the fork's own commits ever added
 *
 * The words it looks for come from the private data root at the time it runs,
 * so none of them are written here: the candidate's name, email addresses,
 * phone, and LinkedIn address; the employers and projects in their record; and
 * every company in their tracker and targets. Upstream's files are left
 * alone, since they ship company names of their own; what is checked is
 * config/local-paths.txt (the fork's paths) and the two READMEs the fork
 * writes. Fixtures and examples use made-up people and companies (Acme,
 * Globex) instead.
 *
 * {DATA_ROOT}/config/leak-check.yml lists the phrases let through, and where,
 * so that list stays private too:
 *   allow:
 *     - { phrase: "Sam Candidate", in: [README.md, site/], why: "the maker's credit" }
 *     - { phrase: Apple, in: ["*"], why: "Apple Calendar, not an employer" }
 *
 * Install as a hook once per clone:
 *   printf '#!/bin/sh\nexec node shukatsu/leak-check.mjs --staged\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
 *
 * Exits 1 when something matches, naming the file, the line, and the word.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--staged') ? 'staged' : process.argv.includes('--history') ? 'history' : 'tree';

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout;
};

const load = (root, rel) => {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try { return yaml.load(readFileSync(path, 'utf-8')); } catch { return null; }
};

/** "Globex Securities" also as "Globex": a company is often written without its suffix. */
const SUFFIX = /\s+(japan|securities|holdings|group|corporation|corp\.?|inc\.?|ltd\.?|llc|co\.?|& partners|and partners|partners|株式会社)$/i;
const shortName = (name) => {
  let s = name;
  for (let i = 0; i < 3 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, '');
  return s.trim();
};

/** The words this repo must never contain, each with where it came from. */
export function termsFrom(root) {
  const terms = new Map();
  const add = (word, why) => {
    const w = String(word || '').replace(/\s+/g, ' ').trim();
    if (w.length >= 4 && !terms.has(w)) terms.set(w, why);
  };

  const profile = load(root, 'config/profile.yml')?.candidate || {};
  const record = load(root, 'data/career-profile.yml') || {};
  const who = record.candidate || {};
  for (const name of [profile.full_name, who.name, who.ja?.name]) {
    add(name, 'your name');
    for (const part of String(name || '').split(/\s+/)) if (part.length >= 5) add(part, 'your name');
  }
  for (const email of [profile.email, who.email, ...(profile.alternate_emails || [])]) add(email, 'your email');
  for (const phone of [profile.phone, who.phone]) {
    add(phone, 'your phone');
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length >= 7) add(digits.slice(-7), 'your phone');
  }
  for (const link of [profile.linkedin, who.linkedin]) add(String(link || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), 'your LinkedIn');

  for (const section of ['experiences', 'projects']) {
    for (const e of record[section] || []) {
      const org = String(e.heading || e.label || '').split(/\s+[—–|·-]\s+|,\s*/)[0];
      add(org, `your record (${section})`);
      add(shortName(org), `your record (${section})`);
    }
  }

  const tracker = join(root, 'data', 'applications.md');
  if (existsSync(tracker)) {
    const lines = readFileSync(tracker, 'utf-8').split('\n').filter((l) => l.startsWith('|'));
    const header = (lines[0] || '').split('|').map((c) => c.trim().toLowerCase());
    const col = header.indexOf('company');
    for (const line of lines.slice(2)) {
      const company = line.split('|')[col]?.trim();
      if (company && company !== '?') { add(company, 'your tracker'); add(shortName(company), 'your tracker'); }
    }
  }
  for (const c of load(root, 'data/targets.yml')?.companies || []) {
    add(c.name, 'your targets');
    add(shortName(c.name), 'your targets');
    for (const ja of [].concat(c.ja ?? [])) add(ja, 'your targets');
  }
  return terms;
}

/** The fork's own files: config/local-paths.txt, plus the READMEs it writes over upstream's. */
function forkPaths() {
  const listed = readFileSync(join(REPO, 'config', 'local-paths.txt'), 'utf-8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return [...listed, 'README.md', 'README.ja.md'];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Blank out the phrases let through for this file ("*" for anywhere, else a path or folder prefix). */
export function allowed(root) {
  const rules = (load(root, 'config/leak-check.yml')?.allow || []).filter((a) => a?.phrase);
  return (file, text) => rules.reduce((t, a) => {
    const where = [].concat(a.in || ['*']);
    if (!where.some((p) => p === '*' || file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`))) return t;
    const phrase = String(a.phrase);
    return t.split(phrase).join(' '.repeat(phrase.length));
  }, text);
}

/** One pattern per word: whole words, and case-insensitive only when the word has a space or a non-letter in it. */
export function matcher(terms) {
  const rules = [...terms.keys()].map((w) => {
    const loose = /[^A-Za-z]/.test(w);
    const ascii = /^[\x20-\x7e]+$/.test(w);
    const body = escape(w);
    return { word: w, re: new RegExp(ascii ? `(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])` : body, loose ? 'i' : '') };
  });
  return (text) => rules.filter((r) => r.re.test(text)).map((r) => r.word);
}

/** Lines to check: [file, line number or commit, text]. */
function* linesToCheck(paths) {
  if (mode === 'tree') {
    for (const file of git('ls-files', '-z', '--', ...paths).split('\0').filter(Boolean)) {
      if (/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip)$/i.test(file)) continue;
      let text;
      try { text = readFileSync(join(REPO, file), 'utf-8'); } catch { continue; }
      let n = 0;
      for (const line of text.split('\n')) { n += 1; yield [file, n, line]; }
    }
    return;
  }
  const diff = mode === 'staged'
    ? git('diff', '--cached', '-U0', '--no-color', '--', ...paths)
    : git('log', '-p', '-U0', '--no-color', '--format=commit %h', '--author', git('config', 'user.name').trim(), '--', ...paths);
  let file = null;
  let at = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('commit ')) { at = line.slice(7); continue; }
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : null; continue; }
    if (line.startsWith('@@')) { const m = line.match(/\+(\d+)/); if (m && mode === 'staged') at = Number(m[1]) - 1; continue; }
    if (!file || !line.startsWith('+')) continue;
    if (mode === 'staged') at += 1;
    yield [file, at, line.slice(1)];
  }
}

if (isMainModule(import.meta.url)) {
  const root = getCareerOpsRoot();
  if (root === REPO || !existsSync(join(root, 'data'))) {
    console.error('leak-check: no private data root is set up here, so there is nothing to check against.');
    process.exit(0);
  }
  const terms = termsFrom(root);
  const find = matcher(terms);
  const allow = allowed(root);
  const hits = [];
  for (const [file, at, text] of linesToCheck(forkPaths())) {
    for (const word of find(allow(file, text))) hits.push(`${file}:${at}  "${word}" (${terms.get(word)})`);
  }
  if (!hits.length) {
    console.log(`leak-check: clean (${terms.size} words from the data root, ${mode === 'tree' ? 'every tracked fork file' : mode === 'staged' ? 'the staged lines' : 'the fork\'s own commits'}).`);
    process.exit(0);
  }
  console.error(`leak-check: ${hits.length} line${hits.length === 1 ? '' : 's'} carry words from your data root. This repo is public:\n`);
  for (const h of hits.slice(0, 200)) console.error(`  ${h}`);
  if (hits.length > 200) console.error(`  ... and ${hits.length - 200} more`);
  console.error('\nUse a made-up name (Acme, Globex, Sam Candidate) instead. If a word is the product\'s own (a platform it supports), say so in the commit and pass --no-verify.');
  process.exit(1);
}
