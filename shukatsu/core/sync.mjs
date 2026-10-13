/**
 * sync.db: copies of outside data (mail, calendar feeds), and the signals
 * read out of them. It sits beside app.db in {DATA_ROOT}/.shukatsu/ and is
 * gitignored with it.
 *
 * The split follows core/store.mjs. Truth stays in the data root's files and
 * app.db keeps who did what; this file holds only what can always be fetched
 * again, so deleting it loses nothing and purging it is a safe thing to offer.
 *
 *   accounts   one row per connected thing (a Gmail account, a calendar feed),
 *              with its settings and its credential as an encrypted blob
 *   cursors    where each account's last sync stopped
 *   records    the copies: a message, an event, a posting, each unique per
 *              account by its outside id, with text capped at 20,000 characters
 *   signals    what a record means for the search (an interview invitation, a
 *              rejection), linked to a tracker row or campaign, with the action
 *              it proposes
 *
 * Messages hold other people's names and addresses, so this file is read only
 * through the inbox operations (the owner and agents they allow), and the
 * secrets in it never leave through any of them.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { stateDir } from './lock.mjs';
import { decryptJson, encryptJson } from './secrets.mjs';

export const SIGNAL_KINDS = ['interview', 'rejection', 'assessment', 'confirmation', 'offer', 'noise', 'other'];
export const SIGNAL_STATUSES = ['open', 'dismissed', 'filed', 'acted'];
export const RECORD_KINDS = ['message', 'event', 'posting'];
export const TEXT_CAP = 20_000;

const MIGRATIONS = [
  `CREATE TABLE accounts (
     id INTEGER PRIMARY KEY,
     connector TEXT NOT NULL,
     label TEXT NOT NULL,
     settings TEXT NOT NULL DEFAULT '{}',
     secret TEXT,
     status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'needs_auth', 'error', 'paused')),
     created_at TEXT NOT NULL,
     last_attempt_at TEXT,
     last_sync_at TEXT,
     last_error TEXT,
     fail_count INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE cursors (
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (account_id, name)
   );
   CREATE TABLE records (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('message', 'event', 'posting')),
     external_id TEXT NOT NULL,
     fields TEXT NOT NULL DEFAULT '{}',
     text TEXT,
     fetched_at TEXT NOT NULL,
     processed_at TEXT,
     UNIQUE (account_id, external_id)
   );
   CREATE INDEX records_kind ON records(account_id, kind);
   CREATE TABLE signals (
     id INTEGER PRIMARY KEY,
     record_id INTEGER NOT NULL UNIQUE REFERENCES records(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('interview', 'rejection', 'assessment', 'confirmation', 'offer', 'noise', 'other')),
     tracker_num INTEGER,
     campaign_id INTEGER,
     confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),
     proposed TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'filed', 'acted')),
     proposal_id INTEGER,
     resolution TEXT,
     created_at TEXT NOT NULL,
     resolved_at TEXT
   );
   CREATE INDEX signals_status ON signals(status, created_at);`,
];

const open = new Map();
export const now = () => new Date().toISOString();

export function syncDb(root) {
  if (open.has(root)) return open.get(root);
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  const d = new DatabaseSync(join(dir, 'sync.db'));
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  d.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = d.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) d.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[version]);
      version++;
      d.prepare('UPDATE schema_version SET version = ?').run(version);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
  open.set(root, d);
  return d;
}

/** Close the connection and forget it (tests that delete the root). */
export function closeSyncDb(root) {
  const d = open.get(root);
  if (d) { try { d.close(); } catch { /* already closed */ } open.delete(root); }
}

const parse = (v, fallback = null) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

// ---------------------------------------------------------------- accounts

/** An account row as callers see it: settings parsed, the secret reduced to whether there is one. */
const publicAccount = (r) => r && ({
  id: r.id, connector: r.connector, label: r.label, settings: parse(r.settings, {}), status: r.status,
  created_at: r.created_at, last_attempt_at: r.last_attempt_at, last_sync_at: r.last_sync_at, last_error: r.last_error,
  fail_count: r.fail_count, has_secret: Boolean(r.secret),
});

export function addAccount(root, { connector, label, settings = {}, secret = null, status = 'ok' }) {
  const r = syncDb(root).prepare('INSERT INTO accounts (connector, label, settings, secret, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(connector, label, JSON.stringify(settings), secret == null ? null : encryptJson(secret), status, now());
  return getAccount(root, Number(r.lastInsertRowid));
}

export const getAccount = (root, id) => publicAccount(syncDb(root).prepare('SELECT * FROM accounts WHERE id = ?').get(id)) || null;

export function listAccounts(root, { connector = null } = {}) {
  const rows = connector
    ? syncDb(root).prepare('SELECT * FROM accounts WHERE connector = ? ORDER BY id').all(connector)
    : syncDb(root).prepare('SELECT * FROM accounts ORDER BY id').all();
  return rows.map(publicAccount);
}

/** The decrypted credential, for the sync step only. Never put this in a result. */
export function getSecret(root, id) {
  const r = syncDb(root).prepare('SELECT secret FROM accounts WHERE id = ?').get(id);
  return r?.secret ? decryptJson(r.secret) : null;
}

export const setSecret = (root, id, secret) => {
  syncDb(root).prepare('UPDATE accounts SET secret = ? WHERE id = ?').run(secret == null ? null : encryptJson(secret), id);
};

export function updateAccount(root, id, { label, settings, status } = {}) {
  const d = syncDb(root);
  if (label !== undefined) d.prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id);
  if (settings !== undefined) d.prepare('UPDATE accounts SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id);
  if (status !== undefined) d.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, id);
  return getAccount(root, id);
}

/** Delete an account with everything copied for it. */
export function removeAccount(root, id) {
  syncDb(root).prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function markAttempt(root, id, { ok, error = null, status = null }) {
  const d = syncDb(root);
  const t = now();
  if (ok) {
    d.prepare(`UPDATE accounts SET last_attempt_at = ?, last_sync_at = ?, last_error = NULL, fail_count = 0,
      status = CASE WHEN status IN ('error', 'needs_auth') THEN 'ok' ELSE status END WHERE id = ?`).run(t, t, id);
  } else {
    d.prepare('UPDATE accounts SET last_attempt_at = ?, last_error = ?, fail_count = fail_count + 1, status = COALESCE(?, CASE WHEN status = \'paused\' THEN status ELSE \'error\' END) WHERE id = ?')
      .run(t, String(error).slice(0, 500), status, id);
  }
}

// ---------------------------------------------------------------- cursors

export const getCursor = (root, accountId, name = 'main') => parse(syncDb(root).prepare('SELECT value FROM cursors WHERE account_id = ? AND name = ?').get(accountId, name)?.value);

export function setCursor(root, accountId, value, name = 'main') {
  syncDb(root).prepare('INSERT INTO cursors (account_id, name, value) VALUES (?, ?, ?) ON CONFLICT(account_id, name) DO UPDATE SET value = excluded.value')
    .run(accountId, name, JSON.stringify(value ?? null));
}

// ---------------------------------------------------------------- records

const recordRow = (r) => r && ({ ...r, fields: parse(r.fields, {}) });

export const hasRecord = (root, accountId, externalId) => Boolean(syncDb(root).prepare('SELECT 1 FROM records WHERE account_id = ? AND external_id = ?').get(accountId, String(externalId)));

/**
 * Store records, updating one already held by its outside id. Returns the
 * rows with `isNew` set for the ones that weren't there before.
 */
export function upsertRecords(root, accountId, records) {
  const d = syncDb(root);
  const out = [];
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const r of records) {
      if (!RECORD_KINDS.includes(r.kind)) throw new Error(`A record is one of ${RECORD_KINDS.join(', ')}.`);
      const ext = String(r.external_id);
      const text = r.text == null ? null : String(r.text).slice(0, TEXT_CAP);
      const before = d.prepare('SELECT id FROM records WHERE account_id = ? AND external_id = ?').get(accountId, ext);
      if (before) {
        d.prepare('UPDATE records SET fields = ?, text = ?, fetched_at = ?, kind = ? WHERE id = ?').run(JSON.stringify(r.fields ?? {}), text, now(), r.kind, before.id);
        out.push({ ...recordRow(d.prepare('SELECT * FROM records WHERE id = ?').get(before.id)), isNew: false });
      } else {
        const ins = d.prepare('INSERT INTO records (account_id, kind, external_id, fields, text, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(accountId, r.kind, ext, JSON.stringify(r.fields ?? {}), text, now());
        out.push({ ...recordRow(d.prepare('SELECT * FROM records WHERE id = ?').get(Number(ins.lastInsertRowid))), isNew: true });
      }
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  return out;
}

/** Delete an account's records of one kind that a full snapshot (a calendar feed) no longer lists. */
export function pruneRecords(root, accountId, kind, keepExternalIds) {
  const d = syncDb(root);
  const keep = new Set(keepExternalIds.map(String));
  const gone = d.prepare('SELECT id, external_id FROM records WHERE account_id = ? AND kind = ?').all(accountId, kind).filter((r) => !keep.has(r.external_id));
  for (const r of gone) d.prepare('DELETE FROM records WHERE id = ?').run(r.id);
  return gone.length;
}

export const getRecord = (root, id) => recordRow(syncDb(root).prepare('SELECT * FROM records WHERE id = ?').get(id)) || null;

export function listRecords(root, { accountId = null, connector = null, kind = null, limit = 5000 } = {}) {
  const where = [];
  const args = [];
  if (accountId) { where.push('r.account_id = ?'); args.push(accountId); }
  if (connector) { where.push('a.connector = ?'); args.push(connector); }
  if (kind) { where.push('r.kind = ?'); args.push(kind); }
  return syncDb(root).prepare(`SELECT r.*, a.connector FROM records r JOIN accounts a ON a.id = r.account_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`)
    .all(...args, limit).map(recordRow);
}

/** Records no one has read for signals yet, oldest first. */
export const unprocessedRecords = (root) => syncDb(root).prepare('SELECT r.*, a.connector FROM records r JOIN accounts a ON a.id = r.account_id WHERE r.processed_at IS NULL ORDER BY r.id').all().map(recordRow);

export const markProcessed = (root, id) => { syncDb(root).prepare('UPDATE records SET processed_at = ? WHERE id = ?').run(now(), id); };

// ---------------------------------------------------------------- signals

const signalRow = (r) => r && ({ ...r, proposed: parse(r.proposed), resolution: parse(r.resolution) });

export function addSignal(root, { record_id, kind, tracker_num = null, campaign_id = null, confidence = 'low', proposed = null, status = 'open' }) {
  if (!SIGNAL_KINDS.includes(kind)) throw new Error(`A signal is one of ${SIGNAL_KINDS.join(', ')}.`);
  const d = syncDb(root);
  const hit = d.prepare('SELECT id FROM signals WHERE record_id = ?').get(record_id);
  if (hit) return getSignal(root, hit.id);
  const r = d.prepare('INSERT INTO signals (record_id, kind, tracker_num, campaign_id, confidence, proposed, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record_id, kind, tracker_num, campaign_id, confidence, proposed ? JSON.stringify(proposed) : null, status, now(), status === 'open' ? null : now());
  return getSignal(root, Number(r.lastInsertRowid));
}

export const getSignal = (root, id) => signalRow(syncDb(root).prepare('SELECT * FROM signals WHERE id = ?').get(id)) || null;

export function listSignals(root, { status = 'open', kind = null, trackerNum = null, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (status && status !== 'all') { where.push('s.status = ?'); args.push(status); }
  if (kind) { where.push('s.kind = ?'); args.push(kind); }
  if (trackerNum) { where.push('s.tracker_num = ?'); args.push(trackerNum); }
  return syncDb(root).prepare(`SELECT s.* FROM signals s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`)
    .all(...args, limit).map(signalRow);
}

export function resolveSignal(root, id, { status, resolution = null, tracker_num }) {
  if (!SIGNAL_STATUSES.includes(status) || status === 'open') throw new Error('A signal is dismissed, filed, or acted on.');
  const d = syncDb(root);
  d.prepare('UPDATE signals SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?').run(status, resolution ? JSON.stringify(resolution) : null, now(), id);
  if (tracker_num) d.prepare('UPDATE signals SET tracker_num = ? WHERE id = ?').run(tracker_num, id);
  return getSignal(root, id);
}

export const openSignalCount = (root) => syncDb(root).prepare("SELECT COUNT(*) AS n FROM signals WHERE status = 'open' AND kind != 'noise'").get().n;

// ---------------------------------------------------------------- purge

/**
 * Delete the copies: records, signals, and cursors for one connector, or for
 * every connector when none is named. Accounts stay (and are marked as never
 * synced) so reconnecting isn't needed; removing an account deletes it whole.
 */
export function purge(root, { connector = null } = {}) {
  const d = syncDb(root);
  const ids = (connector ? d.prepare('SELECT id FROM accounts WHERE connector = ?').all(connector) : d.prepare('SELECT id FROM accounts').all()).map((r) => r.id);
  const counts = { records: 0, signals: 0 };
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const id of ids) {
      counts.signals += Number(d.prepare('DELETE FROM signals WHERE record_id IN (SELECT id FROM records WHERE account_id = ?)').run(id).changes);
      counts.records += Number(d.prepare('DELETE FROM records WHERE account_id = ?').run(id).changes);
      d.prepare('DELETE FROM cursors WHERE account_id = ?').run(id);
      d.prepare('UPDATE accounts SET last_sync_at = NULL, last_error = NULL WHERE id = ?').run(id);
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  return counts;
}

/** Delete sync.db itself, accounts and credentials included. For "remove everything" and tests. */
export function destroy(root) {
  closeSyncDb(root);
  for (const f of ['sync.db', 'sync.db-wal', 'sync.db-shm']) rmSync(join(stateDir(root), f), { force: true });
}
