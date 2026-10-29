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

import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { stateDir } from './lock.mjs';

export const MIGRATIONS = [
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
  // 3: the headless system. Agents are users of kind 'agent' (so the activity
  // log names them), tokens let agents and tools in without a session, OAuth
  // gives remote MCP clients a token, campaigns group a fair's applications,
  // and events are the one calendar: interviews, deadlines, follow-ups, and a
  // campaign's slots, each in its own timezone.
  `CREATE TABLE users_v3 (
     id INTEGER PRIMARY KEY,
     login TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     email TEXT,
     relation TEXT,
     kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'agent')),
     role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer', 'agent')),
     lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ja')),
     password_hash TEXT,
     can_see_comp INTEGER NOT NULL DEFAULT 0,
     can_see_contacts INTEGER NOT NULL DEFAULT 0,
     seen_activity_id INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     last_seen_at TEXT,
     disabled_at TEXT,
     CHECK ((kind = 'agent') = (role = 'agent'))
   );
   INSERT INTO users_v3 (id, login, name, email, relation, role, lang, password_hash, can_see_comp, seen_activity_id, created_at, last_seen_at, disabled_at)
     SELECT id, login, name, email, relation, role, lang, password_hash, can_see_comp, seen_activity_id, created_at, last_seen_at, disabled_at FROM users;
   DROP TABLE users;
   ALTER TABLE users_v3 RENAME TO users;
   CREATE TABLE tokens (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('agent', 'capture', 'feed', 'cli', 'oauth', 'refresh')),
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     prefix TEXT NOT NULL,
     scopes TEXT,
     client_id TEXT,
     parent_id INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
     created_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT,
     last_used_at TEXT,
     last_ip TEXT,
     revoked_at TEXT
   );
   CREATE INDEX tokens_user ON tokens(user_id);
   CREATE TABLE oauth_clients (
     client_id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('metadata', 'registered')),
     name TEXT,
     metadata TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_used_at TEXT
   );
   CREATE TABLE oauth_codes (
     code_hash TEXT PRIMARY KEY,
     client_id TEXT NOT NULL,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     redirect_uri TEXT NOT NULL,
     code_challenge TEXT NOT NULL,
     scope TEXT,
     resource TEXT,
     granted_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at TEXT
   );
   CREATE TABLE campaigns (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'fair' CHECK (kind IN ('fair', 'cycle')),
     url TEXT,
     venue TEXT,
     timezone TEXT NOT NULL DEFAULT 'America/New_York',
     starts_on TEXT,
     ends_on TEXT,
     notes TEXT,
     copied_from INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
     created_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     archived_at TEXT
   );
   CREATE TABLE campaign_rows (
     campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
     tracker_num INTEGER NOT NULL,
     channel TEXT,
     note TEXT,
     added_by INTEGER REFERENCES users(id),
     added_at TEXT NOT NULL,
     PRIMARY KEY (campaign_id, tracker_num)
   );
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('interview', 'deadline', 'followup', 'fair', 'task', 'other')),
     title TEXT NOT NULL,
     starts_at TEXT NOT NULL,
     ends_at TEXT,
     all_day INTEGER NOT NULL DEFAULT 0,
     timezone TEXT NOT NULL,
     location TEXT,
     meeting_url TEXT,
     tracker_num INTEGER,
     campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
     round TEXT,
     source TEXT,
     source_ref TEXT,
     note TEXT,
     created_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     done_at TEXT,
     cancelled_at TEXT
   );
   CREATE INDEX events_start ON events(starts_at);
   CREATE INDEX events_campaign ON events(campaign_id, starts_at);
   CREATE UNIQUE INDEX events_source ON events(source, source_ref) WHERE source_ref IS NOT NULL;`,
  // 4: replies, so a comment thread reads as a discussion.
  `ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;`,
  // 5: where a person gets the digest outside the app (their LINE account), and
  // the short-lived codes that prove a chat account belongs to a signed-in person.
  `CREATE TABLE notify_links (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     channel TEXT NOT NULL CHECK (channel IN ('line')),
     address TEXT NOT NULL,
     linked_at TEXT NOT NULL,
     PRIMARY KEY (user_id, channel),
     UNIQUE (channel, address)
   );
   CREATE TABLE notify_codes (
     code_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     channel TEXT NOT NULL CHECK (channel IN ('line')),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );`,
  // 6: two operations renamed so that "submit" only ever means the candidate's own
  // click on an application form: evaluation.submit is evaluation.file, and
  // packet.submit is packet.requestReview. Their activity verbs follow.
  `UPDATE activity SET verb = 'evaluation.filed' WHERE verb = 'evaluation.submitted';
   UPDATE activity SET verb = 'packet.reviewRequested' WHERE verb = 'packet.submitted';`,
  // 7: asks, the candidate asking one person to look at one item (core/asks.mjs).
  // base is the item as it was when asked; result is what was kept when it closed.
  `CREATE TABLE asks (
     id INTEGER PRIMARY KEY,
     subject TEXT NOT NULL,
     asked_by INTEGER NOT NULL REFERENCES users(id),
     asked_of INTEGER NOT NULL REFERENCES users(id),
     note TEXT,
     base TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed', 'cancelled')),
     reply TEXT,
     reply_note TEXT,
     proposal_id INTEGER REFERENCES proposals(id),
     outcome TEXT CHECK (outcome IN ('used', 'not_used', 'fine')),
     close_note TEXT,
     result TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     answered_at TEXT,
     closed_at TEXT,
     nudged_at TEXT,
     closed_nudged_at TEXT,
     nudge TEXT
   );
   CREATE INDEX asks_of ON asks(asked_of, status);
   CREATE INDEX asks_subject ON asks(subject, status);`,
  // 8: every written answer gets an id that stays with it through edits, so an
  // ask about one answer still finds it after questions are added, moved, renamed
  // or deleted. A function, since the answers are JSON in packets.answers.
  (d) => {
    for (const pk of d.prepare('SELECT id, answers FROM packets WHERE answers IS NOT NULL').all()) {
      const list = JSON.parse(pk.answers);
      if (!Array.isArray(list)) continue;
      d.prepare('UPDATE packets SET answers = ? WHERE id = ?').run(JSON.stringify(withAnswerIds(list)), pk.id);
    }
  },
  // 9: an ask made before answers had ids names its answer by place on the form
  // (packet:3#a2). Point it at the answer now in that place, which migration 8
  // left where it was; one whose place is empty can't be answered, so it is withdrawn.
  (d) => {
    for (const k of d.prepare("SELECT id, subject FROM asks WHERE subject GLOB 'packet:*#a*'").all()) {
      const m = /^packet:(\d+)#a(\d{1,3})$/.exec(k.subject);
      if (!m) continue;
      const pk = d.prepare('SELECT answers FROM packets WHERE id = ?').get(Number(m[1]));
      const a = pk?.answers ? JSON.parse(pk.answers)[Number(m[2]) - 1] : null;
      if (a?.id) d.prepare('UPDATE asks SET subject = ? WHERE id = ?').run(`packet:${m[1]}#${a.id}`, k.id);
      else d.prepare("UPDATE asks SET status = 'cancelled', closed_at = COALESCE(closed_at, datetime('now')) WHERE id = ? AND status IN ('open', 'answered')").run(k.id);
    }
  },
];

/** An answer's id: "a" and 8 hex digits, unique within its packet. */
export const ANSWER_ID = /^a[0-9a-f]{8}$/;

/** The answers, each keeping a valid id it has and getting a fresh one otherwise (a copied id counts as missing). */
export function withAnswerIds(list) {
  const seen = new Set();
  return list.map((a) => {
    let id = ANSWER_ID.test(a?.id) && !seen.has(a.id) ? a.id : null;
    while (!id || seen.has(id)) id = `a${randomBytes(4).toString('hex')}`;
    seen.add(id);
    return { ...a, id };
  });
}

const open = new Map();
export const now = () => new Date().toISOString();

export function db(root) {
  if (open.has(root)) return open.get(root);
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  const d = new DatabaseSync(join(dir, 'app.db'));
  // Foreign keys stay off while migrating: a migration that rebuilds a table
  // (SQLite can't change a CHECK in place) would otherwise cascade its drop
  // into every row that points at it. They're checked once it's done.
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');
  d.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = d.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) d.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    d.exec('BEGIN');
    try {
      const m = MIGRATIONS[version];
      if (typeof m === 'function') m(d); else d.exec(m);
      version++;
      d.prepare('UPDATE schema_version SET version = ?').run(version);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
  const broken = d.prepare('PRAGMA foreign_key_check').all();
  if (broken.length) throw new Error(`app.db has ${broken.length} broken references after migrating (first: ${JSON.stringify(broken[0])}).`);
  d.exec('PRAGMA foreign_keys = ON;');
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
 * (review.accepted, proposal.created, packet.reviewRequested, ...); `subject`
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

export function addComment(root, { actor, subject, body, parentId = null }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('A comment needs some text.');
  if (text.length > 4000) throw new Error('Comments are capped at 4,000 characters.');
  if (parentId != null) {
    const parent = db(root).prepare('SELECT subject FROM comments WHERE id = ?').get(parentId);
    if (!parent || parent.subject !== subject) throw new Error('That reply has nothing to answer here.');
  }
  const r = db(root).prepare('INSERT INTO comments (subject, author_id, body, created_at, parent_id) VALUES (?, ?, ?, ?, ?)').run(subject, actor.id, text, now(), parentId);
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
