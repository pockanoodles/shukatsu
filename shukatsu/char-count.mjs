#!/usr/bin/env node

/**
 * Character-limit check for Japanese application text (ES, CFN "My Resume",
 * 自己PR, 志望動機, ガクチカ).
 *
 * Japanese forms count characters, not words, and most count every character
 * as one regardless of width, so `String.length` is wrong for anything outside
 * the BMP and wrong for combined emoji. This counts grapheme clusters.
 *
 * The norm for ES answers is to fill at least 80% of the limit: a 400-character
 * box answered in 200 characters reads as low effort to a Japanese recruiter.
 *
 * Usage:
 *   node shukatsu/char-count.mjs <file> --limit 400
 *   pbpaste | node shukatsu/char-count.mjs --limit 400
 *   node shukatsu/char-count.mjs <file> --limit 400 --min-fill 0.9
 *   node shukatsu/char-count.mjs --self-test
 *
 * Exit code: 0 within limit, 1 over limit, 2 usage error.
 */

import { readFileSync } from 'fs';
import { isMainModule } from '../lib/is-main-module.mjs';

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

export function countGraphemes(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

// Forms disagree on whether line breaks count, so report both and let the
// stricter one decide.
export function measure(text) {
  const trimmed = text.replace(/\s+$/u, '');
  return {
    withBreaks: countGraphemes(trimmed),
    withoutBreaks: countGraphemes(trimmed.replace(/\r?\n/gu, '')),
  };
}

// Mixed politeness registers in one answer is the most common ES style error.
// Counted on sentence endings only, so quoted speech mid-sentence doesn't trip it.
export function registerMix(text) {
  const desumasu = (text.match(/(です|ます|でした|ました|ません|でしょう)[。！？]/gu) || []).length;
  const dearu = (text.match(/(である|であった|だ|だった|ではない)[。！？]/gu) || []).length;
  return { desumasu, dearu, mixed: desumasu > 0 && dearu > 0 };
}

// "co-op" doesn't parse for a Japanese employer; say 長期インターン with dates.
// Em dashes and semicolons break the candidate's voice rules in either language.
export function styleWarnings(text) {
  const warnings = [];
  if (/co-?op|コープ|コーオプ/iu.test(text)) {
    warnings.push('mentions "co-op": say 6ヶ月の長期インターン（2027年1月〜6月） instead');
  }
  if (/[—–]|――/u.test(text)) warnings.push('contains an em/en dash');
  if (/[;；]/u.test(text)) warnings.push('contains a semicolon');
  if (/[“”‘’]/u.test(text)) warnings.push('contains smart quotes');
  return warnings;
}

export function check(text, { limit, minFill = 0.8 } = {}) {
  const counts = measure(text);
  const used = counts.withBreaks;
  const register = registerMix(text);
  const warnings = styleWarnings(text);
  if (register.mixed) {
    warnings.push(`mixes registers: ${register.desumasu} です・ます endings vs ${register.dearu} だ・である endings`);
  }
  const result = { ...counts, limit: limit ?? null, register, warnings, over: false, underFilled: false };
  if (limit) {
    result.over = used > limit;
    result.fill = used / limit;
    result.underFilled = result.fill < minFill;
  }
  return result;
}

function format(r, minFill) {
  const lines = [];
  const counted = r.withBreaks === r.withoutBreaks
    ? `${r.withBreaks}`
    : `${r.withBreaks} (${r.withoutBreaks} without line breaks)`;
  if (r.limit) {
    const pct = Math.round(r.fill * 100);
    const status = r.over ? 'OVER' : r.underFilled ? 'UNDER-FILLED' : 'OK';
    lines.push(`${status}  ${counted} / ${r.limit} characters (${pct}%)`);
    if (r.over) lines.push(`  cut ${r.withBreaks - r.limit} characters`);
    if (r.underFilled) lines.push(`  add ~${Math.ceil(r.limit * minFill) - r.withBreaks} characters to reach ${Math.round(minFill * 100)}%`);
  } else {
    lines.push(`${counted} characters (no --limit given)`);
  }
  for (const w of r.warnings) lines.push(`  warn: ${w}`);
  return lines.join('\n');
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  assert(countGraphemes('自己PR') === 4, 'mixed-width counts one per character');
  assert(countGraphemes('👨‍👩‍👧') === 1, 'ZWJ emoji is one grapheme');
  assert(measure('あい\nう').withoutBreaks === 3, 'line breaks excluded on request');
  assert(registerMix('頑張りました。それは挑戦だ。').mixed, 'detects mixed register');
  assert(!registerMix('頑張りました。挑戦しました。').mixed, 'consistent register passes');
  assert(styleWarnings('Co-opプログラム').length === 1, 'flags co-op');
  const r = check('あ'.repeat(50), { limit: 100 });
  assert(r.underFilled && !r.over, '50/100 is under-filled');
  assert(check('あ'.repeat(101), { limit: 100 }).over, '101/100 is over');
  console.log('char-count self-test passed');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); process.exit(0); }
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const limit = flag('--limit') ? Number(flag('--limit')) : undefined;
  const minFill = flag('--min-fill') ? Number(flag('--min-fill')) : 0.8;
  if ((limit !== undefined && !(limit > 0)) || !(minFill > 0 && minFill <= 1)) {
    console.error('usage: char-count.mjs [file] --limit N [--min-fill 0.8]');
    process.exit(2);
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--limit', '--min-fill'].includes(args[i - 1]));
  const text = positional[0] ? readFileSync(positional[0], 'utf-8') : readFileSync(0, 'utf-8');
  const result = check(text, { limit, minFill });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else console.log(format(result, minFill));
  process.exit(result.over ? 1 : 0);
}
