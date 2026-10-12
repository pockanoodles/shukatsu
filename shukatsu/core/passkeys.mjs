/**
 * Passkeys (WebAuthn): Face ID / Touch ID / a phone's screen lock as the
 * sign-in, so a parent never has to remember a password.
 *
 * A passkey is bound to the site's domain (the relying party ID), which comes
 * from SHUKATSU_URL. Passkeys made on http://localhost work only there; the
 * served domain needs HTTPS, which the tunnel in shukatsu/deploy provides.
 * A password always remains as the fallback.
 */

import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { randomBytes } from 'crypto';
import { db, logActivity, now } from './store.mjs';
import { getUser } from './people.mjs';

const CHALLENGE_MS = 5 * 60_000;

export function relyingParty() {
  const origin = new URL(process.env.SHUKATSU_URL || 'http://localhost:3000').origin;
  return { origin, rpID: new URL(origin).hostname, rpName: 'shukatsu' };
}

function saveChallenge(root, { userId = null, kind, challenge }) {
  const d = db(root);
  d.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now());
  d.prepare('INSERT INTO challenges (id, user_id, kind, challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomBytes(12).toString('base64url'), userId, kind, challenge, now(), new Date(Date.now() + CHALLENGE_MS).toISOString());
}

function takeChallenge(root, kind, challenge, userId = null) {
  const row = db(root).prepare(`SELECT id FROM challenges WHERE kind = ? AND challenge = ? AND expires_at > ? ${userId ? 'AND user_id = ?' : ''}`)
    .get(...[kind, challenge, now(), ...(userId ? [userId] : [])]);
  if (!row) return false;
  db(root).prepare('DELETE FROM challenges WHERE id = ?').run(row.id);
  return true;
}

export const passkeysFor = (root, userId) => db(root).prepare('SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').all(userId);

export async function registrationOptions(root, user) {
  const { rpID, rpName } = relyingParty();
  const existing = db(root).prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id);
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: user.login, userDisplayName: user.name,
    userID: new TextEncoder().encode(`shukatsu-user-${user.id}`),
    attestationType: 'none',
    excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  saveChallenge(root, { userId: user.id, kind: 'register', challenge: options.challenge });
  return options;
}

export async function finishRegistration(root, user, response, name = '') {
  const { origin, rpID } = relyingParty();
  let challenge = null;
  const v = await verifyRegistrationResponse({
    response, expectedOrigin: origin, expectedRPID: rpID,
    expectedChallenge: (c) => { challenge = c; return takeChallenge(root, 'register', c, user.id); },
  });
  if (!v.verified || !v.registrationInfo) throw new Error('The passkey couldn\'t be verified. Try again.');
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  db(root).prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter,
    JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0, String(name || '').slice(0, 60) || null, now());
  logActivity(root, { actor: user, verb: 'person.passkey', subject: `person:${user.id}`, detail: { challenge: Boolean(challenge) } });
  return credential.id;
}

/** Discoverable sign-in: no login typed, the device offers its passkeys for this site. */
export async function authenticationOptions(root) {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
  saveChallenge(root, { kind: 'auth', challenge: options.challenge });
  return options;
}

export async function finishAuthentication(root, response) {
  const { origin, rpID } = relyingParty();
  const key = db(root).prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id || ''));
  if (!key) throw Object.assign(new Error('passkey.unknown'), { code: 'passkey.unknown' });
  const v = await verifyAuthenticationResponse({
    response, expectedOrigin: origin, expectedRPID: rpID,
    expectedChallenge: (c) => takeChallenge(root, 'auth', c),
    credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: key.transports ? JSON.parse(key.transports) : undefined },
  });
  if (!v.verified) throw Object.assign(new Error('passkey.failed'), { code: 'passkey.failed' });
  db(root).prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(v.authenticationInfo.newCounter, now(), key.id);
  const user = getUser(root, key.user_id);
  if (!user || user.disabled_at) throw Object.assign(new Error('signin.failed'), { code: 'signin.failed' });
  return user;
}

export function removePasskey(root, { actor, id }) {
  const key = db(root).prepare('SELECT user_id FROM passkeys WHERE id = ?').get(id);
  if (!key) return;
  if (key.user_id !== actor.id && actor.role !== 'owner') throw new Error('You can only remove your own passkeys.');
  db(root).prepare('DELETE FROM passkeys WHERE id = ?').run(id);
  logActivity(root, { actor, verb: 'person.passkey-removed', subject: `person:${key.user_id}` });
}
