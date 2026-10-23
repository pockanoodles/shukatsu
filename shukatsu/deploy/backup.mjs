#!/usr/bin/env node

/**
 * backup.mjs -- snapshot everything shukatsu can't regenerate.
 *
 *   node shukatsu/deploy/backup.mjs <target-dir> [<target-dir> ...] [--keep 14] [--min-hours 20]
 *
 * Writes, into each <target-dir>/<timestamp>/:
 *   app.db          a consistent copy of the app database (VACUUM INTO, safe while running)
 *   data-root.bundle  a git bundle of the data root (every commit, every branch)
 *   untracked.tar     the data root's gitignored files that matter (jds/, output/, data/pipeline.md)
 * and deletes all but the newest --keep snapshots there.
 *
 * A target on a disk that isn't plugged in (its nearest existing folder is
 * /Volumes, /media, or /mnt) is skipped rather than created on the boot disk,
 * and --min-hours skips a target whose newest snapshot is younger than that.
 * Together they let one job run nightly and on every disk mount: the internal
 * copy stays daily, and an external disk gets a snapshot whenever it is
 * attached. Exits 1 if any target that was there failed.
 *
 * The database holds password hashes and every comment, so point every
 * <target-dir> at an encrypted volume. See deploy/README.md for the schedule.
 */

import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const keep = Number(valueOf('--keep')) || 14;
const minHours = Number(valueOf('--min-hours')) || 0;
const flagValues = new Set([valueOf('--keep'), valueOf('--min-hours')].filter(Boolean));
const targets = args.filter((a) => !a.startsWith('--') && !flagValues.has(a)).map((t) => resolve(t));
if (!targets.length) { console.error('usage: node shukatsu/deploy/backup.mjs <target-dir> [<target-dir> ...] [--keep 14] [--min-hours 20]'); process.exit(2); }

const root = getCareerOpsRoot();
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}T/;
const MOUNT_PARENTS = new Set(['/Volumes', '/media', '/mnt']);

/** Whether the disk a target lives on is attached: its nearest existing folder isn't a bare mount parent. */
function mounted(target) {
  let dir = target;
  while (!existsSync(dir)) dir = dirname(dir);
  return !MOUNT_PARENTS.has(dir) && !/^\/(run\/)?media\/[^/]+$/.test(dir);
}

const snapshots = (target) => (existsSync(target) ? readdirSync(target).filter((d) => SNAPSHOT.test(d)).sort() : []);

/** The time a snapshot folder's name records, e.g. 2026-10-23T04-45-00. */
const takenAt = (name) => Date.parse(name.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3Z'));

function snapshot(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(target, stamp);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let ok = true;

  const dbPath = join(root, '.shukatsu', 'app.db');
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec(`VACUUM INTO '${join(dir, 'app.db').replace(/'/g, "''")}'`);
    db.close();
    console.log('  app.db');
  }

  const bundle = spawnSync('git', ['-C', root, 'bundle', 'create', join(dir, 'data-root.bundle'), '--all'], { encoding: 'utf-8' });
  ok &&= bundle.status === 0;
  console.log(bundle.status === 0 ? '  data-root.bundle' : `  git bundle failed: ${bundle.stderr.trim()}`);

  const extras = ['jds', 'output', 'data/pipeline.md', 'data/scan-history.tsv'].filter((p) => existsSync(join(root, p)));
  if (extras.length) {
    const tar = spawnSync('tar', ['-cf', join(dir, 'untracked.tar'), '-C', root, ...extras], { encoding: 'utf-8' });
    ok &&= tar.status === 0;
    console.log(tar.status === 0 ? `  untracked.tar (${extras.join(', ')})` : `  tar failed: ${tar.stderr.trim()}`);
  }

  const snaps = snapshots(target);
  for (const old of snaps.slice(0, Math.max(0, snaps.length - keep))) rmSync(join(target, old), { recursive: true, force: true });
  console.log(`  kept ${Math.min(snaps.length, keep)} snapshots`);
  return ok;
}

let failed = false;
for (const target of targets) {
  if (!mounted(target)) { console.log(`${target}: skipped, its disk isn't attached`); continue; }
  const newest = snapshots(target).at(-1);
  const ageHours = newest ? (Date.now() - takenAt(newest)) / 3_600_000 : Infinity;
  if (ageHours < minHours) { console.log(`${target}: skipped, the newest snapshot is ${ageHours.toFixed(1)} hours old`); continue; }
  console.log(`${target}:`);
  try {
    if (!snapshot(target)) failed = true;
  } catch (e) {
    console.error(`  failed: ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
