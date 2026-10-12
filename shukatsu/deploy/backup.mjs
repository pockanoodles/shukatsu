#!/usr/bin/env node

/**
 * backup.mjs -- snapshot everything shukatsu can't regenerate.
 *
 *   node shukatsu/deploy/backup.mjs <target-dir> [--keep 14]
 *
 * Writes, into <target-dir>/<timestamp>/:
 *   app.db          a consistent copy of the app database (VACUUM INTO, safe while running)
 *   data-root.bundle  a git bundle of the data root (every commit, every branch)
 *   untracked.tar     the data root's gitignored files that matter (jds/, output/, data/pipeline.md)
 * and deletes all but the newest --keep snapshots.
 *
 * The database holds password hashes and every comment, so point <target-dir> at an
 * encrypted volume. Run it daily from cron or launchd (see deploy/README.md).
 */

import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const keep = Number(args[args.indexOf('--keep') + 1]) || 14;
if (!target) { console.error('usage: node shukatsu/deploy/backup.mjs <target-dir> [--keep 14]'); process.exit(2); }

const root = getCareerOpsRoot();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = join(target, stamp);
mkdirSync(dir, { recursive: true });

const dbPath = join(root, '.shukatsu', 'app.db');
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec(`VACUUM INTO '${join(dir, 'app.db').replace(/'/g, "''")}'`);
  db.close();
  console.log('app.db');
}

const bundle = spawnSync('git', ['-C', root, 'bundle', 'create', join(dir, 'data-root.bundle'), '--all'], { encoding: 'utf-8' });
console.log(bundle.status === 0 ? 'data-root.bundle' : `git bundle failed: ${bundle.stderr.trim()}`);

const extras = ['jds', 'output', 'data/pipeline.md', 'data/scan-history.tsv'].filter((p) => existsSync(join(root, p)));
if (extras.length) {
  const tar = spawnSync('tar', ['-cf', join(dir, 'untracked.tar'), '-C', root, ...extras], { encoding: 'utf-8' });
  console.log(tar.status === 0 ? `untracked.tar (${extras.join(', ')})` : `tar failed: ${tar.stderr.trim()}`);
}

const snaps = readdirSync(target).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort();
for (const old of snaps.slice(0, Math.max(0, snaps.length - keep))) rmSync(join(target, old), { recursive: true, force: true });
console.log(`kept ${Math.min(snaps.length, keep)} snapshots in ${target}`);
