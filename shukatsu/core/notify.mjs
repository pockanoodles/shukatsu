/**
 * Where people get the digest outside the app: one chat account per person
 * per channel (LINE, for now), kept in app.db beside the people themselves.
 *
 * Linking works like an invite. A signed-in person asks for a code
 * (notify.linkCode, their own session only), then sends it from their chat
 * app to the install's account. The webhook that receives it calls redeem(),
 * which ties that chat account to the person the code was made for. The code
 * is the proof, so redeem() runs outside the operations registry, the same
 * way accepting an invite does: there is no principal yet, only a code.
 *
 * Codes are six digits, live 15 minutes, work once, and are kept hashed. One
 * code per person: asking again replaces the last one. Guessing is held back
 * by the webhook's rate limit, and only the chat service can reach it at all.
 *
 * A disabled person keeps their link but receives nothing, so restoring
 * access restores the digest too.
 */

import { createHash, randomInt } from 'crypto';
import { db, logActivity, now, tx } from './store.mjs';
import { getUser } from './people.mjs';

export const CHANNELS = ['line'];
const CODE_MINUTES = 15;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const check = (channel) => { if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel "${channel}".`); };

/** A fresh code for this person, replacing any they had. Returns { code, expires_at }. */
export function createCode(root, { actor, channel = 'line' }) {
  check(channel);
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  return tx(root, (d) => {
    d.prepare('DELETE FROM notify_codes WHERE user_id = ? AND channel = ?').run(actor.id, channel);
    d.prepare('DELETE FROM notify_codes WHERE expires_at < ?').run(now());
    for (;;) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (d.prepare('SELECT 1 FROM notify_codes WHERE code_hash = ?').get(sha256(code))) continue;
      d.prepare('INSERT INTO notify_codes (code_hash, user_id, channel, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha256(code), actor.id, channel, now(), expires);
      return { code, expires_at: expires };
    }
  });
}

/** What a chat message looks like when it is a code: six digits, allowing spaces or full-width digits a phone keyboard may send. */
export function codeIn(text) {
  const digits = String(text || '').normalize('NFKC').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Tie `address` (the chat service's id for the sender) to the person the code
 * was made for. Returns that person, or null for a wrong or expired code.
 * The chat account moves if it was linked to someone else, and the person's
 * old chat account, if any, is replaced.
 */
export function redeem(root, { channel = 'line', code, address }) {
  check(channel);
  if (!code || !address) return null;
  const user = tx(root, (d) => {
    const row = d.prepare('SELECT user_id, expires_at FROM notify_codes WHERE code_hash = ? AND channel = ?').get(sha256(code), channel);
    if (!row) return null;
    d.prepare('DELETE FROM notify_codes WHERE code_hash = ?').run(sha256(code));
    if (row.expires_at < now()) return null;
    const person = getUser(root, row.user_id);
    if (!person || person.disabled_at) return null;
    d.prepare('DELETE FROM notify_links WHERE channel = ? AND (address = ? OR user_id = ?)').run(channel, address, person.id);
    d.prepare('INSERT INTO notify_links (user_id, channel, address, linked_at) VALUES (?, ?, ?, ?)').run(person.id, channel, address, now());
    return person;
  });
  if (user) logActivity(root, { actor: user, verb: 'notify.linked', subject: `person:${user.id}`, detail: { channel } });
  return user;
}

/** The chat service says this account left (blocked or removed the install's account). */
export function forgetAddress(root, { channel = 'line', address }) {
  const row = db(root).prepare('SELECT user_id FROM notify_links WHERE channel = ? AND address = ?').get(channel, address);
  if (!row) return false;
  db(root).prepare('DELETE FROM notify_links WHERE channel = ? AND address = ?').run(channel, address);
  logActivity(root, { actor: getUser(root, row.user_id), verb: 'notify.unlinked', subject: `person:${row.user_id}`, detail: { channel, by: 'chat' } });
  return true;
}

/** Take a person's link away. The person themselves, or the owner. */
export function unlink(root, { actor, userId, channel = 'line' }) {
  check(channel);
  const hit = db(root).prepare('DELETE FROM notify_links WHERE user_id = ? AND channel = ?').run(userId, channel);
  db(root).prepare('DELETE FROM notify_codes WHERE user_id = ? AND channel = ?').run(userId, channel);
  if (hit.changes) logActivity(root, { actor, verb: 'notify.unlinked', subject: `person:${userId}`, detail: { channel } });
  return hit.changes > 0;
}

/** One person's link, or null. Never returns the chat address. */
export function linkOf(root, userId, channel = 'line') {
  const row = db(root).prepare('SELECT linked_at FROM notify_links WHERE user_id = ? AND channel = ?').get(userId, channel);
  return row ? { linked_at: row.linked_at } : null;
}

/** Everyone linked on a channel, with whether they can receive now. Never returns the chat address. */
export function links(root, channel = 'line') {
  return db(root).prepare(`SELECT u.id AS user_id, u.name, u.role, u.lang, u.disabled_at, l.linked_at FROM notify_links l JOIN users u ON u.id = l.user_id
    WHERE l.channel = ? ORDER BY u.role = 'owner' DESC, l.linked_at`).all(channel)
    .map((r) => ({ user_id: r.user_id, name: r.name, role: r.role, lang: r.lang, linked_at: r.linked_at, active: !r.disabled_at }));
}

/** Who gets a message: linked people who still have access, with the address. For the sender only. */
export function recipients(root, channel = 'line', { userId = null } = {}) {
  return db(root).prepare(`SELECT u.id AS user_id, u.name, u.role, u.lang, l.address FROM notify_links l JOIN users u ON u.id = l.user_id
    WHERE l.channel = ? AND u.disabled_at IS NULL AND u.kind = 'person' ${userId ? 'AND u.id = ?' : ''} ORDER BY l.linked_at`).all(...(userId ? [channel, userId] : [channel]));
}
