/**
 * App state: people, sessions, proposals, comments, packets, and the activity
 * log, in one SQLite file at {DATA_ROOT}/.shukatsu/app.db (gitignored).
 *
 * The split is deliberate. Truth (facts, the tracker, resumes) stays in the
 * data root's files, where git versions it and every CLI can read it. This
 * database holds only what exists because more than one person uses the
 * system: who they are, what they proposed, what they said. Losing it loses
 * conversations, never a fact.
 *
 * Built on node:sqlite, so a fresh machine needs no native build step.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { stateDir } from './lock.mjs';

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     login TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     email TEXT,
     relation TEXT,
     role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
     lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ja')),
     password_hash TEXT,
     can_see_comp INTEGER NOT NULL DEFAULT 0,
     seen_activity_id INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     last_seen_at TEXT,
     disabled_at TEXT
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     ip TEXT,
     user_agent TEXT,
     method TEXT NOT NULL DEFAULT 'password'
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE invites (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     name TEXT NOT NULL,
     relation TEXT,
     lang TEXT NOT NULL DEFAULT 'en',
     created_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at TEXT,
     used_by INTEGER REFERENCES users(id),
     revoked_at TEXT
   );
   CREATE TABLE passkeys (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     public_key BLOB NOT NULL,
     counter INTEGER NOT NULL DEFAULT 0,
     transports TEXT,
     device_type TEXT,
     backed_up INTEGER NOT NULL DEFAULT 0,
     name TEXT,
     created_at TEXT NOT NULL,
     last_used_at TEXT
   );
   CREATE TABLE challenges (
     id TEXT PRIMARY KEY,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     challenge TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE login_attempts (
     id INTEGER PRIMARY KEY,
     key TEXT NOT NULL,
     at TEXT NOT NULL,
     ok INTEGER NOT NULL
   );
   CREATE INDEX login_attempts_key ON login_attempts(key, at);
   CREATE TABLE proposals (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL,
     target TEXT,
     payload TEXT NOT NULL,
     base TEXT,
     note TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'withdrawn')),
     author_id INTEGER NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     decided_by INTEGER REFERENCES users(id),
     decided_at TEXT,
     decision_note TEXT,
     result TEXT
   );
   CREATE INDEX proposals_status ON proposals(status, created_at);
   CREATE TABLE comments (
     id INTEGER PRIMARY KEY,
     subject TEXT NOT NULL,
     author_id INTEGER NOT NULL REFERENCES users(id),
     body TEXT NOT NULL,
     created_at TEXT NOT NULL,
     edited_at TEXT,
     resolved_at TEXT,
     resolved_by INTEGER REFERENCES users(id)
   );
   CREATE INDEX comments_subject ON comments(subject, created_at);
   CREATE TABLE packets (
     id INTEGER PRIMARY KEY,
     company TEXT NOT NULL,
     role TEXT NOT NULL,
     url TEXT,
     jd_path TEXT,
     archetype TEXT NOT NULL,
     lang TEXT NOT NULL DEFAULT 'en',
     manifest TEXT,
     status TEXT NOT NULL DEFAULT 'drafting'
       CHECK (status IN ('drafting', 'in_review', 'changes_requested', 'ready', 'sent', 'closed')),
     tracker_num INTEGER,
     cover_letter TEXT,
     notes TEXT,
     created_by INTEGER NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     sent_on TEXT
   );
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     actor_id INTEGER REFERENCES users(id),
     verb TEXT NOT NULL,
     subject TEXT,
     detail TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX activity_subject ON activity(subject, id);
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // 2: written answers on application forms (ES, 志望動機, "Why us?"), with their limits.
  `ALTER TABLE packets ADD COLUMN answers TEXT;`,
];

const open = new Map();
export const now = () => new Date().toISOString();

export function db(root) {
  if (open.has(root)) return open.get(root);
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  const d = new DatabaseSync(join(dir, 'app.db'));
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

/** Run `fn` in one transaction. */
export function tx(root, fn) {
  const d = db(root);
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export const json = (v) => (v == null ? null : JSON.stringify(v));
export const parse = (v) => (v == null ? null : JSON.parse(v));

export function getSetting(root, key, fallback = null) {
  const r = db(root).prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}

export function setSetting(root, key, value) {
  db(root).prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

// ---------------------------------------------------------------- activity

/**
 * Append to the activity log. `verb` is a stable key the UI translates
 * (review.accepted, proposal.created, packet.submitted, ...); `subject`
 * names the thing ("fact:foresight.cache", "proposal:12", "packet:3").
 */
export function logActivity(root, { actor, verb, subject = null, detail = null }) {
  db(root).prepare('INSERT INTO activity (actor_id, verb, subject, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actor?.id ?? null, verb, subject, json(detail), now());
}

export function recentActivity(root, { limit = 50, before = null, subject = null } = {}) {
  const where = [];
  const args = [];
  if (before) { where.push('a.id < ?'); args.push(before); }
  if (subject) { where.push('(a.subject = ? OR a.subject LIKE ?)'); args.push(subject, `${subject}#%`); }
  const rows = db(root).prepare(`SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM activity a
    LEFT JOIN users u ON u.id = a.actor_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.id DESC LIMIT ?`).all(...args, limit);
  return rows.map((r) => ({ ...r, detail: parse(r.detail) }));
}

// ---------------------------------------------------------------- comments

export function addComment(root, { actor, subject, body }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('A comment needs some text.');
  if (text.length > 4000) throw new Error('Comments are capped at 4,000 characters.');
  const r = db(root).prepare('INSERT INTO comments (subject, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(subject, actor.id, text, now());
  logActivity(root, { actor, verb: 'comment.added', subject, detail: { comment: Number(r.lastInsertRowid), excerpt: text.slice(0, 140) } });
  return Number(r.lastInsertRowid);
}

export function comments(root, subject) {
  return db(root).prepare(`SELECT c.*, u.name AS author_name, u.role AS author_role FROM comments c
    JOIN users u ON u.id = c.author_id WHERE c.subject = ? ORDER BY c.created_at`).all(subject);
}

export function commentCounts(root) {
  const out = new Map();
  for (const r of db(root).prepare('SELECT subject, COUNT(*) AS n FROM comments WHERE resolved_at IS NULL GROUP BY subject').all()) out.set(r.subject, r.n);
  return out;
}

export function resolveComment(root, { actor, id }) {
  db(root).prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL').run(now(), actor.id, id);
}
