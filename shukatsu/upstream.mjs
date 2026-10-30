#!/usr/bin/env node

/**
 * upstream.mjs -- take career-ops releases into the fork, through git.
 *
 *   node shukatsu/upstream.mjs review [<tag>]   # what the release changes that matters here
 *   node shukatsu/upstream.mjs review --json
 *   node shukatsu/upstream.mjs merge [<tag>]    # merge it on update/<version>, uncommitted
 *   node shukatsu/upstream.mjs pick <sha>       # one upstream fix between releases
 *
 * <tag> defaults to the newest career-ops-v* release. Use this instead of
 * `update-system.mjs apply`, which copies files and freezes the ones the fork
 * edits; see core/upstream.mjs.
 */

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from '../lib/is-main-module.mjs';
import { printUsage } from './core/usage.mjs';
import { latestRelease, merge, mergeText, pick, review, reviewText } from './core/upstream.mjs';

const ENGINE = dirname(dirname(fileURLToPath(import.meta.url)));

if (isMainModule(import.meta.url) && ['--help', '-h'].some((f) => process.argv.includes(f))) {
  printUsage(import.meta.url);
} else if (isMainModule(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.find((a) => !a.startsWith('--'));
  try {
    if (cmd === 'review') {
      const r = review(ENGINE, arg || latestRelease(ENGINE));
      process.stdout.write(rest.includes('--json') ? `${JSON.stringify(r, null, 2)}\n` : reviewText(r));
    } else if (cmd === 'merge') {
      const tag = arg || latestRelease(ENGINE);
      process.stdout.write(reviewText(review(ENGINE, tag)));
      process.stdout.write(`\n${mergeText(merge(ENGINE, tag))}`);
    } else if (cmd === 'pick' && arg) {
      console.log(`Picked: ${pick(ENGINE, arg)}`);
    } else {
      console.error('usage: node shukatsu/upstream.mjs review [<tag>] [--json] | merge [<tag>] | pick <sha>');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
