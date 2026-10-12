#!/usr/bin/env node

/**
 * digest.mjs -- the weekly digest as plain text, ready to paste into LINE,
 * iMessage, or an email to the people following the search.
 *
 *   node shukatsu/digest.mjs              # last 7 days, English
 *   node shukatsu/digest.mjs --lang ja    # 日本語
 *   node shukatsu/digest.mjs --days 14
 *   node shukatsu/digest.mjs --json
 */

import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { digest, digestText } from './core/digest.mjs';

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i === -1 ? null : argv[i + 1]; };
  try {
    const d = digest(getCareerOpsRoot(), { days: Number(opt('days')) || 7 });
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify(d, null, 2)}\n` : digestText(d, opt('lang') === 'ja' ? 'ja' : 'en'));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
