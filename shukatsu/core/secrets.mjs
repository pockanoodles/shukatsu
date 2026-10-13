/**
 * Encryption for the credentials connectors hold (a Gmail refresh token, a
 * calendar feed's private address).
 *
 * The data root is a git repository and a backup target, so a credential must
 * never sit in it in the clear. sync.db keeps each secret as an AES-256-GCM
 * blob, and the key lives somewhere the data root never reaches:
 *
 *   1. SHUKATSU_SYNC_KEY (base64, 32 bytes), which tests and containers use
 *   2. the file named by SHUKATSU_SYNC_KEY_FILE, when set (skips the Keychain)
 *   3. the macOS Keychain, service "shukatsu", account "sync-key"
 *   4. a 0600 file at ~/.config/shukatsu/sync.key, on Linux or when the
 *      Keychain can't be reached (a launchd job with no login session)
 *
 * The key is created on first use. Nothing here logs a key or a plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { homedir } from 'os';
import { dirname, join } from 'path';

const SERVICE = 'shukatsu';
const ACCOUNT = 'sync-key';
const keyFile = () => process.env.SHUKATSU_SYNC_KEY_FILE || join(homedir(), '.config', 'shukatsu', 'sync.key');

let cached = null;

const fromBase64 = (s) => {
  const buf = Buffer.from(String(s).trim(), 'base64');
  if (buf.length !== 32) throw new Error('The sync key must be 32 bytes, base64 encoded.');
  return buf;
};

function keychain(args) {
  const r = spawnSync('security', args, { encoding: 'utf-8', timeout: 8000 });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
}

function fromKeychain() {
  if (process.platform !== 'darwin') return null;
  const found = keychain(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']);
  if (found) return fromBase64(found);
  const fresh = randomBytes(32).toString('base64');
  return keychain(['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', fresh]) !== null ? fromBase64(fresh) : null;
}

function fromFile() {
  const path = keyFile();
  if (existsSync(path)) return fromBase64(readFileSync(path, 'utf-8'));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fresh = randomBytes(32).toString('base64');
  writeFileSync(path, `${fresh}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return fromBase64(fresh);
}

function key() {
  if (cached) return cached;
  if (process.env.SHUKATSU_SYNC_KEY) cached = fromBase64(process.env.SHUKATSU_SYNC_KEY);
  else if (process.env.SHUKATSU_SYNC_KEY_FILE) cached = fromFile();
  else cached = fromKeychain() || fromFile();
  return cached;
}

/** Forget the key held in memory (tests that change the environment). */
export const forgetKey = () => { cached = null; };

/** Encrypt a string (or any JSON value) to "v1.iv.tag.ciphertext", each part base64url. */
export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const body = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** The string encrypt() was given. Throws when the blob was altered or the key is different. */
export function decrypt(blob) {
  const [v, iv, tag, body] = String(blob).split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('That is not a shukatsu secret.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf-8');
}

export const encryptJson = (obj) => encrypt(JSON.stringify(obj));
export const decryptJson = (blob) => JSON.parse(decrypt(blob));
