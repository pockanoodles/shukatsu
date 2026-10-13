/**
 * OAuth 2.0 for a Google "web" app the owner creates in their own Google Cloud
 * project: authorization code flow with PKCE, scope gmail.readonly,
 * access_type=offline and prompt=consent so Google issues a refresh token.
 *
 * A project left in "Testing" mode makes Google expire its refresh tokens after
 * seven days. The owner publishes it as an unverified production app for their
 * own account instead, which is allowed for personal use and keeps the token
 * alive. The settings page says so next to the fields.
 */

import { createHash, randomBytes } from 'crypto';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const PENDING_MS = 10 * 60_000;

const b64 = (buf) => buf.toString('base64url');

/** A fresh state value and PKCE pair. */
export function newPending() {
  const verifier = b64(randomBytes(48));
  return { state: b64(randomBytes(24)), verifier, challenge: b64(createHash('sha256').update(verifier).digest()), at: Date.now() };
}

export function authorizeUrl({ clientId, redirectUri, state, challenge }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return u.href;
}

const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

/** Trade the one-time code for tokens. `fetch` is the connector's guarded, audited fetch. */
export async function exchangeCode(fetch, { clientId, clientSecret, code, verifier, redirectUri }) {
  const res = await fetch(TOKEN_URL, { purpose: 'oauth.code', ...form({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri }) });
  return res.json();
}

/** A short-lived access token from the stored refresh token. */
export async function refreshAccess(fetch, { clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, { purpose: 'oauth.refresh', ...form({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }) });
  return res.json();
}
