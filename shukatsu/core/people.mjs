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
 *   agent     an AI agent or tool (kind 'agent'), named by the owner, signed
 *             in by token only. It does the candidate's work (tracker,
 *             pipeline, evaluations, packets, calendar, campaigns) and every
 *             write is logged under its name, but it can never stamp.
 *
 * Stamps are the actions that make something true or final: deciding a
 * review (confirm, correct, can't-confirm, reject, accept a proposal),
 * marking a packet sent, and changing who has access. They are refused for
 * any principal of kind 'agent' in can() itself, apart from the role
 * matrix, so editing the matrix can never hand an agent a stamp.
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

export const ROLES = ['owner', 'editor', 'reviewer', 'viewer', 'agent'];
/** Roles a person can hold (an agent's role is always 'agent'). */
export const PERSON_ROLES = ROLES.filter((r) => r !== 'agent');

const MATRIX = {
  'view': ['owner', 'editor', 'reviewer', 'viewer', 'agent'],
  'view.profile': ['owner', 'editor', 'reviewer', 'viewer', 'agent'],
  'view.review': ['owner', 'editor', 'reviewer', 'agent'],
  'view.evidence-path': ['owner'],
  'comment': ['owner', 'editor', 'reviewer', 'agent'],
  'suggest.posting': ['owner', 'editor', 'reviewer', 'agent'],
  'propose.profile': ['owner', 'editor', 'agent'],
  'packet.create': ['owner', 'editor', 'agent'],
  'packet.edit': ['owner', 'editor', 'agent'],
  'tracker.write': ['owner', 'agent'],
  'pipeline.write': ['owner', 'agent'],
  'evaluation.file': ['owner', 'agent'],
  'calendar.read': ['owner', 'editor', 'reviewer', 'viewer', 'agent'],
  'calendar.write': ['owner', 'agent'],
  'campaign.write': ['owner', 'agent'],
  'inbox.read': ['owner', 'agent'],
  'inbox.write': ['owner', 'agent'],
  'posting.capture': ['owner', 'agent'],
  // Only the extension, through the owner's capture key: an agent has no browser to have read a page in.
  'page.observe': ['owner'],
  'application.fill': ['owner'],
  'answers.manage': ['owner'],
  // Linking your own chat account for the digest. People only: an agent has no phone to link.
  'notify.self': ['owner', 'editor', 'reviewer', 'viewer'],
  // Stamps: owner only, and never an agent whatever this table says (see can()).
  'review.decide': ['owner'],
  'packet.send': ['owner'],
  // Moving a row to Applied or Hired, the states that record the candidate's own act.
  'tracker.decide': ['owner'],
  'profile.write': ['owner'],
  'people.manage': ['owner'],
  'settings.system': ['owner'],
  'agent.manage': ['owner'],
  'token.manage': ['owner'],
  'connector.manage': ['owner'],
};

/** The permissions that make something true or final. A human session only. */
export const STAMPS = new Set(['review.decide', 'packet.send', 'tracker.decide', 'profile.write', 'people.manage', 'settings.system', 'agent.manage', 'token.manage', 'connector.manage']);

/** Every permission name, so a caller can precompute what a person may do. */
export const PERMISSIONS = [...Object.keys(MATRIX), 'view.comp', 'view.contacts'];

export function can(user, action) {
  if (!user || user.disabled_at) return false;
  if (STAMPS.has(action) && (user.kind === 'agent' || user.role === 'agent')) return false;
  // Per-person grants: the owner sees everything; anyone else only when granted.
  if (action === 'view.comp') return user.role === 'owner' || Boolean(user.can_see_comp);
  if (action === 'view.contacts') return user.role === 'owner' || (user.kind === 'agent' && Boolean(user.can_see_contacts));
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

const USER_COLS = 'id, login, name, email, relation, kind, role, lang, can_see_comp, can_see_contacts, seen_activity_id, created_at, last_seen_at, disabled_at';

/** The people on this install (agents are listed by listAgents). */
export const listUsers = (root) => db(root).prepare(`SELECT ${USER_COLS}, (password_hash IS NOT NULL) AS has_password,
  (SELECT COUNT(*) FROM passkeys k WHERE k.user_id = users.id) AS passkeys FROM users WHERE kind = 'person' ORDER BY role = 'owner' DESC, created_at`).all();
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
  const allowed = self ? ['name', 'email', 'lang'] : ['name', 'email', 'lang', 'relation', 'role', 'can_see_comp', 'can_see_contacts'];
  if (changes.role && target.role === 'owner') throw new Error('The owner stays the owner.');
  if (changes.role && !(target.kind === 'agent' ? ['agent'] : PERSON_ROLES).includes(changes.role)) throw new Error('Unknown role.');
  if (changes.can_see_contacts != null && target.kind !== 'agent') throw new Error('Contacts are shared with agents only; people see them through the candidate.');
  if (changes.role === 'owner') throw new Error('There is one owner per install.');
  const sets = Object.entries(changes).filter(([k]) => allowed.includes(k));
  if (!sets.length) return target;
  db(root).prepare(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...sets.map(([k, v]) => (k === 'can_see_comp' || k === 'can_see_contacts' ? (v ? 1 : 0) : v)), id);
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
    d.prepare('DELETE FROM passkeys WHERE user_id = ?').run(id);
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
  if (!PERSON_ROLES.includes(role)) throw new Error('Unknown role.');
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
  const row = db(root).prepare("SELECT id, password_hash, disabled_at FROM users WHERE login = ? AND kind = 'person'").get(String(login));
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

// ---------------------------------------------------------------- agents

const SYSTEM_LOGIN = '_shukatsu';
const agentSlug = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'agent';

/** Agents on this install, with their live token counts. The built-in sync agent is left out. */
export const listAgents = (root) => db(root).prepare(`SELECT ${USER_COLS}, (SELECT COUNT(*) FROM tokens t WHERE t.user_id = users.id AND t.revoked_at IS NULL
  AND (t.expires_at IS NULL OR t.expires_at > ?)) AS tokens FROM users WHERE kind = 'agent' AND login != ? ORDER BY disabled_at IS NOT NULL, created_at`).all(now(), SYSTEM_LOGIN);

/**
 * A named agent identity ("Claude Code on the laptop", "claude.ai"). It holds
 * the agent role, has no password and no passkey, and signs in by token only.
 */
export function createAgent(root, { actor, name, canSeeComp = false, canSeeContacts = false }) {
  assertCan(actor, 'agent.manage');
  const label = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!label) throw new Error('An agent needs a name, so the activity log can say which one did what.');
  return tx(root, (d) => {
    let login = `agent-${agentSlug(label)}`;
    for (let n = 2; d.prepare('SELECT 1 FROM users WHERE login = ?').get(login); n++) login = `agent-${agentSlug(label)}-${n}`;
    const r = d.prepare(`INSERT INTO users (login, name, kind, role, lang, can_see_comp, can_see_contacts, created_at) VALUES (?, ?, 'agent', 'agent', 'en', ?, ?, ?)`)
      .run(login, label, canSeeComp ? 1 : 0, canSeeContacts ? 1 : 0, now());
    const agent = getUser(root, Number(r.lastInsertRowid));
    logActivity(root, { actor, verb: 'agent.created', subject: `person:${agent.id}`, detail: { name: label } });
    return agent;
  });
}

/** Cut an agent off: disabled and every token revoked. Its history stays under its name. */
export function disableAgent(root, { actor, id }) {
  assertCan(actor, 'agent.manage');
  const target = getUser(root, id);
  if (!target || target.kind !== 'agent') throw new Error('No such agent.');
  tx(root, (d) => {
    d.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(now(), id);
    d.prepare('UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), id);
  });
  logActivity(root, { actor, verb: 'agent.disabled', subject: `person:${id}`, detail: { name: target.name } });
}

/**
 * The install's own agent, which connectors and the scheduler act as, so a
 * proposal filed from an email has an author and the log says "shukatsu".
 * It has no token and can't sign in.
 */
export function systemAgent(root) {
  const d = db(root);
  const found = d.prepare(`SELECT ${USER_COLS} FROM users WHERE login = ?`).get(SYSTEM_LOGIN);
  if (found) return found;
  d.prepare(`INSERT OR IGNORE INTO users (login, name, kind, role, lang, created_at) VALUES (?, 'shukatsu', 'agent', 'agent', 'en', ?)`).run(SYSTEM_LOGIN, now());
  return d.prepare(`SELECT ${USER_COLS} FROM users WHERE login = ?`).get(SYSTEM_LOGIN);
}

// ---------------------------------------------------------------- tokens

/**
 * Bearer tokens. Each belongs to one user (an agent, or the owner for the
 * capture bookmarklet, a calendar feed, and the CLI) and has a kind:
 *
 *   agent    an agent's key for the API and MCP; scopes '*' or op names
 *   capture  the browser extension: saving pages (posting.capture,
 *            page.observe) and filling forms (application.plan, .filled).
 *            Planning returns the answer bank, so this key reads the
 *            candidate's contact details and stated answers; keep it in the
 *            extension only
 *   feed     one private calendar feed (/cal/{token}.ics), read-only
 *   cli      the owner's terminal, kept in .shukatsu/owner.token (0600)
 *   oauth    an access token issued to a remote MCP client (1 hour)
 *   refresh  that client's refresh token (30 days, rotated on use)
 *
 * Only a hash is stored. The raw value is returned once, prefixed with its
 * kind (shk_agent_...) so a leaked one is recognizable in a log or a scan.
 */
export const TOKEN_KINDS = ['agent', 'capture', 'feed', 'cli', 'oauth', 'refresh'];
const TOKEN_SCOPES = { capture: ['posting.capture', 'page.observe', 'application.plan', 'application.filled', 'answers.suggest'], feed: ['calendar.feed'] };

export function issueToken(root, { actor = null, userId, kind, name, scopes = null, days = null, clientId = null, parentId = null }) {
  if (!TOKEN_KINDS.includes(kind)) throw new Error(`Unknown token kind "${kind}".`);
  // Tokens a person makes by hand need the owner; OAuth tokens are issued by the authorization server itself.
  if (!['oauth', 'refresh'].includes(kind)) assertCan(actor, 'token.manage');
  const user = getUser(root, userId);
  if (!user || user.disabled_at) throw new Error('That identity is disabled or gone.');
  if (kind === 'agent' && user.kind !== 'agent') throw new Error('Agent tokens belong to an agent. Create one on the Agents page first.');
  if (['capture', 'cli'].includes(kind) && user.role !== 'owner') throw new Error(`A ${kind} token acts as the candidate, so it belongs to the owner.`);
  const raw = `shk_${kind}_${newToken()}`;
  const scope = TOKEN_SCOPES[kind] || (Array.isArray(scopes) && scopes.length ? scopes : ['*']);
  const expires = days ? new Date(Date.now() + days * DAY).toISOString() : null;
  const r = db(root).prepare(`INSERT INTO tokens (user_id, kind, name, token_hash, prefix, scopes, client_id, parent_id, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, kind, String(name || kind).slice(0, 80), sha256(raw), raw.slice(0, kind.length + 9), JSON.stringify(scope), clientId, parentId, actor?.id ?? null, now(), expires);
  if (!['oauth', 'refresh'].includes(kind)) logActivity(root, { actor, verb: 'token.created', subject: `person:${userId}`, detail: { kind, name } });
  return { id: Number(r.lastInsertRowid), token: raw, expires_at: expires };
}

export const listTokens = (root, { userId = null, kinds = null } = {}) => db(root).prepare(`SELECT t.id, t.user_id, t.kind, t.name, t.prefix, t.scopes, t.client_id,
  t.created_at, t.expires_at, t.last_used_at, t.last_ip, u.name AS user_name FROM tokens t JOIN users u ON u.id = t.user_id
  WHERE t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?) AND t.kind NOT IN ('refresh') ${userId ? 'AND t.user_id = ?' : ''}
  ORDER BY t.created_at DESC`).all(...[now(), ...(userId ? [userId] : [])]).filter((t) => !kinds || kinds.includes(t.kind))
  .map((t) => ({ ...t, scopes: JSON.parse(t.scopes || '["*"]') }));

export function revokeToken(root, { actor, id }) {
  const t = db(root).prepare('SELECT id, user_id, kind, name FROM tokens WHERE id = ?').get(id);
  if (!t) return;
  if (!['oauth', 'refresh'].includes(t.kind) || actor) assertCan(actor, 'token.manage');
  db(root).prepare('UPDATE tokens SET revoked_at = ? WHERE (id = ? OR parent_id = ?) AND revoked_at IS NULL').run(now(), id, id);
  if (actor) logActivity(root, { actor, verb: 'token.revoked', subject: `person:${t.user_id}`, detail: { kind: t.kind, name: t.name } });
}

/** The user and token behind a raw bearer token, or null. Touches last use at most once a minute. */
export function tokenUser(root, raw, { ip = null, kinds = null } = {}) {
  if (typeof raw !== 'string' || !raw.startsWith('shk_') || raw.length < 40) return null;
  const t = db(root).prepare('SELECT * FROM tokens WHERE token_hash = ?').get(sha256(raw));
  if (!t || t.revoked_at || (t.expires_at && t.expires_at <= now())) return null;
  if (kinds && !kinds.includes(t.kind)) return null;
  const user = getUser(root, t.user_id);
  if (!user || user.disabled_at) return null;
  if (!t.last_used_at || Date.now() - Date.parse(t.last_used_at) > 60_000) {
    db(root).prepare('UPDATE tokens SET last_used_at = ?, last_ip = ? WHERE id = ?').run(now(), ip, t.id);
  }
  return { user, token: { id: t.id, kind: t.kind, name: t.name, scopes: JSON.parse(t.scopes || '["*"]'), client_id: t.client_id, parent_id: t.parent_id, expires_at: t.expires_at } };
}

/** Swap a refresh token for its replacement (rotation): the old one stops working. */
export function consumeRefresh(root, raw) {
  const hit = tokenUser(root, raw, { kinds: ['refresh'] });
  if (!hit) return null;
  db(root).prepare('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(now(), hit.token.id);
  return hit;
}
