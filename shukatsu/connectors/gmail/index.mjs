/**
 * gmail (mail.read): the owner's mailbox, searched and never browsed.
 *
 * The owner makes a Google Cloud OAuth client for their own account, enters its
 * id and secret on the settings page, and signs in once. The refresh token is
 * kept encrypted in sync.db. Each sync runs the search from query.mjs for mail
 * newer than the last sync, fetches only messages not already held, and stores
 * a Message record per hit: sender, recipients, subject, time, the plain text
 * capped at 20,000 characters, and the links in it. Attachments and the rest of
 * the mailbox are never requested.
 */

import { readFileSync } from 'fs';
import { getAccount, getSecret, setSecret, updateAccount } from '../../core/sync.mjs';
import { makeConnectorCtx } from '../ctx.mjs';
import { authorizeUrl, exchangeCode, newPending, PENDING_MS, refreshAccess } from './oauth.mjs';
import { buildQueries, searchDomains } from './query.mjs';

export const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf-8'));

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DAY = 86_400_000;
const MAX_FETCH = 300;
const MAX_PAGES = 5;

const needsAuth = (message) => Object.assign(new Error(message), { code: 'needs_auth' });

/** Turn what the settings form sent into an account's settings and secret. */
export function prepare(input, previous = null) {
  const clientId = (input.client_id ?? previous?.settings?.client_id ?? '').trim();
  const clientSecret = (input.client_secret ?? previous?.secret?.client_secret ?? '').trim();
  if (!clientId || !clientSecret) throw new Error('Gmail needs the OAuth client id and client secret from your Google Cloud project.');
  const days = input.lookback_days ?? previous?.settings?.lookback_days ?? 60;
  const changed = previous && (clientId !== previous.settings.client_id || clientSecret !== previous.secret?.client_secret);
  return {
    settings: { client_id: clientId, lookback_days: days, domains: previous?.settings?.domains || [] },
    // A different client can't use the old refresh token, so signing in happens again.
    secret: { client_secret: clientSecret, refresh_token: changed ? null : previous?.secret?.refresh_token ?? null },
    status: changed || !previous?.secret?.refresh_token ? 'needs_auth' : undefined,
  };
}

// ---------------------------------------------------------------- messages

const decode = (data) => Buffer.from(String(data || ''), 'base64url').toString('utf-8');

const htmlToText = (html) => html
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

function bodyOf(part, found = { plain: [], html: [] }) {
  if (!part) return found;
  if (part.mimeType === 'text/plain' && part.body?.data) found.plain.push(decode(part.body.data));
  else if (part.mimeType === 'text/html' && part.body?.data) found.html.push(decode(part.body.data));
  for (const p of part.parts || []) bodyOf(p, found);
  return found;
}

export function linksIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/https?:\/\/[^\s"'<>()]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '').replace(/&amp;/g, '&');
    if (!out.includes(url)) out.push(url);
    if (out.length >= 20) break;
  }
  return out;
}

/** A Gmail API message as a Message record. */
export function messageRecord(msg) {
  const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  const { plain, html } = bodyOf(msg.payload);
  const text = (plain.join('\n\n') || htmlToText(html.join('\n'))).trim();
  return {
    kind: 'message',
    external_id: msg.id,
    fields: {
      thread: msg.threadId || null, from: headers.from || '', to: headers.to || '', subject: headers.subject || '',
      received_at: new Date(Number(msg.internalDate) || Date.parse(headers.date) || Date.now()).toISOString(),
      links: linksIn(text), labels: msg.labelIds || [],
    },
    text,
  };
}

// ---------------------------------------------------------------- tokens

const tokens = new Map();

async function accessToken(account, ctx) {
  const hit = tokens.get(account.id);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const s = account.secret || {};
  if (!s.refresh_token) throw needsAuth('Gmail is not signed in yet. Use Connect on the settings page.');
  let res;
  try {
    res = await refreshAccess(ctx.fetch, { clientId: account.settings.client_id, clientSecret: s.client_secret, refreshToken: s.refresh_token });
  } catch (e) {
    if (/invalid_grant|invalid_client|unauthorized_client/.test(e.message) || e.status === 401) {
      tokens.delete(account.id);
      throw needsAuth('Google no longer accepts this sign-in. A Google Cloud project left in Testing mode loses its token after 7 days, so publish it as an unverified production app for your own account, then connect again.');
    }
    throw e;
  }
  if (!res.access_token) throw new Error('Google did not return an access token.');
  tokens.set(account.id, { token: res.access_token, expires: Date.now() + (res.expires_in || 3000) * 1000 });
  return res.access_token;
}

// ---------------------------------------------------------------- sync

export async function sync(account, cursor, ctx) {
  const started = ctx.now();
  const token = await accessToken(account, ctx);
  const headers = { authorization: `Bearer ${token}` };
  const lookback = account.settings.lookback_days || 60;
  const days = cursor?.last_ms ? Math.min(lookback, Math.ceil((started - cursor.last_ms) / DAY) + 1) : lookback;
  const queries = buildQueries({ domains: searchDomains(ctx.root, account.settings.domains || []), days });

  const ids = new Set();
  for (const q of queries) {
    let page = null;
    for (let n = 0; n < MAX_PAGES; n++) {
      const params = new URLSearchParams({ q, maxResults: '100', ...(page ? { pageToken: page } : {}) });
      const res = await ctx.fetchJson(`${API}/messages?${params}`, { headers, purpose: 'gmail.list' });
      for (const m of res.messages || []) ids.add(m.id);
      page = res.nextPageToken;
      if (!page) break;
    }
  }

  const fresh = [...ids].filter((id) => !ctx.has(id));
  const take = fresh.slice(0, MAX_FETCH);
  const records = [];
  for (const id of take) {
    try {
      records.push(messageRecord(await ctx.fetchJson(`${API}/messages/${encodeURIComponent(id)}?format=full`, { headers, purpose: 'gmail.get' })));
    } catch (e) {
      if (e.status !== 404) throw e; // deleted since the search
    }
  }
  // A long backlog finishes over a few runs: until nothing is left over, the window stays where it was.
  const done = fresh.length <= MAX_FETCH;
  return { records, cursor: done ? { last_ms: started } : cursor };
}

// ---------------------------------------------------------------- sign-in

/** Start sign-in for an account: remember the one-time values, return Google's address. */
export function beginAuth(root, accountId, redirectUri) {
  const account = getAccount(root, accountId);
  const secret = getSecret(root, accountId);
  if (!account || account.connector !== 'gmail' || !secret?.client_secret) throw new Error('Add the Gmail client id and secret first.');
  const pending = newPending();
  setSecret(root, accountId, { ...secret, pending: { state: pending.state, verifier: pending.verifier, at: pending.at } });
  return authorizeUrl({ clientId: account.settings.client_id, redirectUri, state: pending.state, challenge: pending.challenge });
}

/** Finish sign-in: find the account that started it, trade the code, keep the refresh token. Returns the account id. */
export async function completeAuth(root, { state, code, redirectUri, accounts, fetch = null }) {
  for (const account of accounts) {
    const secret = getSecret(root, account.id);
    const p = secret?.pending;
    if (!p || p.state !== state) continue;
    if (Date.now() - p.at > PENDING_MS) throw new Error('That sign-in took too long. Start it again.');
    const ctx = makeConnectorCtx(root, manifest, account, { fetch });
    const res = await exchangeCode(ctx.fetch, { clientId: account.settings.client_id, clientSecret: secret.client_secret, code, verifier: p.verifier, redirectUri });
    if (!res.refresh_token) throw new Error('Google signed you in but sent no refresh token. Remove shukatsu under your Google account\'s third-party access and connect again.');
    const { pending: _done, ...rest } = secret;
    setSecret(root, account.id, { ...rest, refresh_token: res.refresh_token });
    tokens.delete(account.id);
    updateAccount(root, account.id, { status: 'ok' });
    return account.id;
  }
  throw new Error('That sign-in was not started here, or it has expired.');
}

export const forgetTokens = () => tokens.clear();
