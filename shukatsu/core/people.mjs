/**
 * People, roles, and sign-in.
 *
 * One install serves one candidate. The candidate is the `owner`; everyone
 * else is invited by them, holds one role, and can be cut off in one click.
 *
 *   owner     the candidate. The only person who can verify a fact, decide a
 *             review, change the tracker, or invite anyone. Submitting an
 *             application is theirs alone and never happens in this app.
 *   editor    a mentor or parent who does the work: proposes profile changes,
 *             prepares whole application packets, suggests postings, comments.
 *             Everything they make lands in the owner's review queue.
 *   reviewer  reads everything shared, comments, and suggests postings.
 *   viewer    reads the tracker, the profile, and the weekly digest.
 *
 * Contacts and evidence file paths are owner-only. Compensation is hidden from
 * everyone else unless the owner grants it per person.
 *
 * Sign-in: invite link -> choose a login and password (and optionally add a
 * passkey). There is no public sign-up. The first owner is created from the
 * command line (`node shukatsu/people.mjs init`), so a fresh server exposed to
 * the internet can't be claimed by whoever finds it first.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { db, logActivity, now, tx } from './store.mjs';

export const ROLES = ['owner', 'editor', 'reviewer', 'viewer'];

const MATRIX = {
  'view': ['owner', 'editor', 'reviewer', 'viewer'],
  'view.profile': ['owner', 'editor', 'reviewer', 'viewer'],
  'view.review': ['owner', 'editor', 'reviewer'],
  'view.contacts': ['owner'],
  'view.evidence-path': ['owner'],
  'comment': ['owner', 'editor', 'reviewer'],
  'suggest.posting': ['owner', 'editor', 'reviewer'],
  'propose.profile': ['owner', 'editor'],
  'packet.create': ['owner', 'editor'],
  'packet.edit': ['owner', 'editor'],
  'review.decide': ['owner'],
  'tracker.write': ['owner'],
  'profile.write': ['owner'],
  'people.manage': ['owner'],
  'settings.system': ['owner'],
};

/** Every permission name, so a caller can precompute what a person may do. */
export const PERMISSIONS = [...Object.keys(MATRIX), 'view.comp'];

export function can(user, action) {
  if (!user || user.disabled_at) return false;
  if (action === 'view.comp') return user.role === 'owner' || Boolean(user.can_see_comp);
  const allowed = MATRIX[action];
  if (!allowed) throw new Error(`Unknown permission "${action}"`);
  return allowed.includes(user.role);
}

export function assertCan(user, action) {
  if (!can(user, action)) {
    const err = new Error('You do not have permission to do that.');
    err.status = 403;
    throw err;
  }
}

// ---------------------------------------------------------------- secrets

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

// scrypt at N=2^15 costs ~50ms and 32MB, which is fine for a handful of people
// and slow for anyone guessing.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function checkPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(expected, got);
}

export function passwordProblem(password, login = '') {
  if (typeof password !== 'string' || password.length < 10) return 'password.short';
  if (password.length > 200) return 'password.long';
  if (login && password.toLowerCase().includes(login.toLowerCase())) return 'password.login';
  return null;
}

// ---------------------------------------------------------------- users

const USER_COLS = 'id, login, name, email, relation, role, lang, can_see_comp, seen_activity_id, created_at, last_seen_at, disabled_at';

export const listUsers = (root) => db(root).prepare(`SELECT ${USER_COLS}, (password_hash IS NOT NULL) AS has_password,
  (SELECT COUNT(*) FROM passkeys k WHERE k.user_id = users.id) AS passkeys FROM users ORDER BY role = 'owner' DESC, created_at`).all();
export const getUser = (root, id) => db(root).prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) || null;
export const owner = (root) => db(root).prepare(`SELECT ${USER_COLS} FROM users WHERE role = 'owner' AND disabled_at IS NULL ORDER BY id LIMIT 1`).get() || null;
export const hasOwner = (root) => Boolean(owner(root));

function loginProblem(login) {
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(login || '')) return 'login.format';
  return null;
}

export function updateUser(root, { actor, id, changes }) {
  const target = getUser(root, id);
  if (!target) throw new Error('No such person.');
  const self = actor.id === id;
  if (!self) assertCan(actor, 'people.manage');
  const allowed = self ? ['name', 'email', 'lang'] : ['name', 'email', 'lang', 'relation', 'role', 'can_see_comp'];
  if (changes.role && target.role === 'owner') throw new Error('The owner stays the owner.');
  if (changes.role && !ROLES.includes(changes.role)) throw new Error('Unknown role.');
  if (changes.role === 'owner') throw new Error('There is one owner per install.');
  const sets = Object.entries(changes).filter(([k]) => allowed.includes(k));
  if (!sets.length) return target;
  db(root).prepare(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...sets.map(([k, v]) => (k === 'can_see_comp' ? (v ? 1 : 0) : v)), id);
  logActivity(root, { actor, verb: 'person.updated', subject: `person:${id}`, detail: { fields: sets.map(([k]) => k), role: changes.role } });
  return getUser(root, id);
}

export function setPassword(root, { actor, id, password }) {
  if (actor.id !== id) throw new Error('Only you can set your password.');
  const user = getUser(root, id);
  const problem = passwordProblem(password, user.login);
  if (problem) throw Object.assign(new Error(problem), { code: problem });
  db(root).prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  logActivity(root, { actor, verb: 'person.password', subject: `person:${id}` });
}

/** Cut someone off: disabled, every session and passkey gone, open invites revoked. */
export function disableUser(root, { actor, id }) {
  assertCan(actor, 'people.manage');
  const target = getUser(root, id);
  if (!target) throw new Error('No such person.');
  if (target.role === 'owner') throw new Error('The owner can\'t be disabled.');
  tx(root, (d) => {
    d.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(now(), id);
    d.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    d.prepare('UPDATE invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now(), id);
  });
  logActivity(root, { actor, verb: 'person.disabled', subject: `person:${id}`, detail: { name: target.name } });
}

export function enableUser(root, { actor, id }) {
  assertCan(actor, 'people.manage');
  db(root).prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(id);
  logActivity(root, { actor, verb: 'person.enabled', subject: `person:${id}` });
}

// ---------------------------------------------------------------- invites

const DAY = 86_400_000;

/**
 * An invite link for a new person, or (with `userId`) a fresh sign-in link for
 * someone who forgot their password. Returns the raw token once; only its
 * hash is stored.
 */
export function createInvite(root, { actor, role, name, relation = null, lang = 'en', days = 7, userId = null }) {
  if (actor) assertCan(actor, 'people.manage');
  else if (hasOwner(root) || role !== 'owner') throw new Error('Only the owner can invite people.');
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  if (role === 'owner' && hasOwner(root) && !userId) throw new Error('There is one owner per install.');
  if (!String(name || '').trim()) throw new Error('An invite needs a name.');
  const token = newToken();
  db(root).prepare(`INSERT INTO invites (token_hash, user_id, role, name, relation, lang, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256(token), userId, role, String(name).trim(), relation, lang, actor?.id ?? null, now(), new Date(Date.now() + days * DAY).toISOString());
  logActivity(root, { actor, verb: userId ? 'invite.reset' : 'invite.created', subject: userId ? `person:${userId}` : null, detail: { name, role } });
  return token;
}

export function openInvites(root) {
  return db(root).prepare(`SELECT i.rowid AS id, i.user_id, i.role, i.name, i.relation, i.lang, i.created_at, i.expires_at, u.name AS created_by_name
    FROM invites i LEFT JOIN users u ON u.id = i.created_by
    WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`).all(now());
}

export function revokeInvite(root, { actor, id }) {
  assertCan(actor, 'people.manage');
  db(root).prepare('UPDATE invites SET revoked_at = ? WHERE rowid = ? AND used_at IS NULL').run(now(), id);
  logActivity(root, { actor, verb: 'invite.revoked' });
}

/** The invite behind a token, or null when it's unknown, used, revoked, or expired. */
export function peekInvite(root, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const inv = db(root).prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token));
  if (!inv || inv.used_at || inv.revoked_at || inv.expires_at <= now()) return null;
  return { ...inv, user: inv.user_id ? getUser(root, inv.user_id) : null };
}

/** Accept an invite: create the person (or reset an existing one's password). Returns the user. */
export function acceptInvite(root, token, { login, password, name = null, lang = null }) {
  return tx(root, (d) => {
    const inv = peekInvite(root, token);
    if (!inv) throw Object.assign(new Error('invite.invalid'), { code: 'invite.invalid' });
    let userId = inv.user_id;
    if (userId) {
      const user = getUser(root, userId);
      const problem = passwordProblem(password, user.login);
      if (problem) throw Object.assign(new Error(problem), { code: problem });
      d.prepare('UPDATE users SET password_hash = ?, disabled_at = NULL WHERE id = ?').run(hashPassword(password), userId);
      d.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    } else {
      const lp = loginProblem(login);
      if (lp) throw Object.assign(new Error(lp), { code: lp });
      if (d.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw Object.assign(new Error('login.taken'), { code: 'login.taken' });
      const problem = passwordProblem(password, login);
      if (problem) throw Object.assign(new Error(problem), { code: problem });
      if (inv.role === 'owner' && d.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) throw new Error('There is one owner per install.');
      const r = d.prepare(`INSERT INTO users (login, name, relation, role, lang, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(login, (name || inv.name).trim(), inv.relation, inv.role, lang || inv.lang, hashPassword(password), now());
      userId = Number(r.lastInsertRowid);
    }
    d.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token_hash = ?').run(now(), userId, sha256(token));
    const user = getUser(root, userId);
    logActivity(root, { actor: user, verb: inv.user_id ? 'person.reset' : 'person.joined', subject: `person:${userId}`, detail: { role: user.role } });
    return user;
  });
}

// ---------------------------------------------------------------- sessions

const SESSION_DAYS = 30;
const TOUCH_MS = 5 * 60_000;

export function createSession(root, user, { ip = null, userAgent = null, method = 'password' } = {}) {
  const token = newToken();
  const t = now();
  db(root).prepare(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256(token), user.id, t, t, new Date(Date.now() + SESSION_DAYS * DAY).toISOString(), ip, userAgent?.slice(0, 300) ?? null, method);
  db(root).prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t, user.id);
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

/** The signed-in user for a session token, sliding its expiry; null when invalid. */
export function sessionUser(root, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const s = db(root).prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s || s.expires_at <= now()) return null;
  const user = getUser(root, s.user_id);
  if (!user || user.disabled_at) return null;
  if (Date.now() - Date.parse(s.last_seen_at) > TOUCH_MS) {
    const t = now();
    db(root).prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(t, new Date(Date.now() + SESSION_DAYS * DAY).toISOString(), s.token_hash);
    db(root).prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t, user.id);
  }
  return { ...user, session: { created_at: s.created_at, method: s.method, hash: s.token_hash } };
}

export const endSession = (root, token) => db(root).prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(String(token)));

export const sessionsFor = (root, userId) => db(root).prepare('SELECT token_hash, created_at, last_seen_at, ip, user_agent, method FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC').all(userId, now());

export function endSessionByHash(root, { actor, hash }) {
  const s = db(root).prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(hash);
  if (!s) return;
  if (s.user_id !== actor.id) assertCan(actor, 'people.manage');
  db(root).prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
}

// ---------------------------------------------------------------- password sign-in

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 8;
let dummyHash = null;

function throttled(root, key) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  return db(root).prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0').get(key, since).n >= MAX_FAILS;
}

/** Check a login + password. Returns the user, or throws a coded error. Rate limited per login and per IP. */
export function signIn(root, { login, password, ip = 'unknown' }) {
  const keys = [`login:${String(login).toLowerCase()}`, `ip:${ip}`];
  if (keys.some((k) => throttled(root, k))) throw Object.assign(new Error('signin.throttled'), { code: 'signin.throttled' });
  const row = db(root).prepare('SELECT id, password_hash, disabled_at FROM users WHERE login = ?').get(String(login));
  // Hash anyway on a miss (one scrypt, same as a hit), so a response time
  // doesn't say whether a login exists.
  dummyHash ??= hashPassword(newToken());
  const ok = row?.password_hash ? checkPassword(String(password), row.password_hash) : (checkPassword(String(password), dummyHash), false);
  const record = db(root).prepare('INSERT INTO login_attempts (key, at, ok) VALUES (?, ?, ?)');
  for (const k of keys) record.run(k, now(), ok ? 1 : 0);
  db(root).prepare('DELETE FROM login_attempts WHERE at < ?').run(new Date(Date.now() - 24 * 3_600_000).toISOString());
  if (!ok || row.disabled_at) throw Object.assign(new Error('signin.failed'), { code: 'signin.failed' });
  return getUser(root, row.id);
}

/** Whether `password` is this person's current password (for changing it). Not throttled, not logged as a sign-in. */
export function verifyPassword(root, id, password) {
  const row = db(root).prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  return Boolean(row?.password_hash && checkPassword(String(password), row.password_hash));
}
