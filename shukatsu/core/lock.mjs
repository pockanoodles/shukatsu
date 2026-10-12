/**
 * One writer at a time for the data root's truth files. The CLI and the app
 * both write career-profile.yml, so every write takes this lock first.
 *
 * mkdir is atomic on every filesystem this runs on, which makes it the lock.
 * A lock older than STALE_MS belongs to a process that died mid-write and is
 * broken; a profile write takes milliseconds, so that can't cut a live one off.
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';

const STALE_MS = 30_000;
const WAIT_MS = 10_000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const stateDir = (root) => join(root, '.shukatsu');

export function withLock(root, name, fn) {
  const dir = join(stateDir(root), 'locks', `${name}.lock`);
  mkdirSync(dirname(dir), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid} ${new Date().toISOString()}\n`);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - statSync(dir).mtimeMs; } catch { continue; }
      if (age > STALE_MS) { rmSync(dir, { recursive: true, force: true }); continue; }
      if (Date.now() - started > WAIT_MS) {
        let owner = '';
        try { owner = readFileSync(join(dir, 'owner'), 'utf-8').trim(); } catch {}
        throw new Error(`${name} is locked by another writer (${owner || 'unknown'}). Try again in a moment.`);
      }
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write through a temp file and rename, so a reader never sees half a file. */
export function writeAtomic(path, content) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
