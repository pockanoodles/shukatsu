#!/usr/bin/env node

/**
 * target.mjs -- fill a tracker row's Target and Due, from the terminal.
 *
 *   node shukatsu/target.mjs <row#> [--target KEY] [--due YYYY-MM-DD]
 *
 * Target is an outcome key from data/targets.yml (e.g. summer-27) and Due the
 * deadline, optionally followed by a short note (--due "2026-11-20 19:00 ET").
 * `—` clears either one. merge-tracker.mjs leaves both as `—` on a new row,
 * because upstream has no field for them, so run this once the row exists.
 */

import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { callOp } from './core/client.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}

async function cli(argv) {
  const a = args(argv);
  const num = Number(a._[0]);
  if (!Number.isInteger(num) || num < 1 || (a.target === undefined && a.due === undefined)) {
    console.error('Usage: node shukatsu/target.mjs <row#> [--target KEY] [--due YYYY-MM-DD]');
    return 2;
  }
  const r = await callOp(getCareerOpsRoot(), 'tracker.setTargetDue', {
    num, ...(a.target !== undefined ? { target: String(a.target) } : {}), ...(a.due !== undefined ? { due: String(a.due) } : {}),
  });
  console.log(`#${r.num}: Target ${r.target ?? '(no column)'}, Due ${r.due ?? '(no column)'}${r.changed ? '' : ' (already so)'}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
