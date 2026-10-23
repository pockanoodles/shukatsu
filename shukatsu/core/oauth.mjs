/**
 * The daemon as its own OAuth authorization server, for the MCP authorization
 * spec (2025-06-18): remote clients such as claude.ai that can't be handed a
 * bearer header get an access token by sending the owner through a consent
 * screen in the app.
 *
 *   discovery   /.well-known/oauth-authorization-server (RFC 8414)
 *               /.well-known/oauth-protected-resource[/mcp] (RFC 9728)
 *   clients     a client ID metadata document (client_id is an https URL we
 *               fetch, guarded) or dynamic registration (RFC 7591)
 *   flow        authorization code with PKCE S256 only, public clients only
 *   tokens      kind 'oauth' for an hour, kind 'refresh' for 30 days, rotated
 *   revoke      RFC 7009
 *
 * Granting is a stamp by nature. /oauth/authorize never issues anything: it
 * checks the request and sends the browser to the app's consent page with a
 * signed, expiring request id. Only the owner, signed in recently, picks which
 * agent identity the client receives, and `grant` is the one function that
 * writes a code. A code is bound to that agent's user id, stored only as a
 * hash, good for ten minutes, and spent once.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { consumeRefresh, getUser, issueToken, revokeToken, tokenUser } from './people.mjs';
import { db, getSetting, logActivity, now, setSetting } from './store.mjs';
import { logEgress } from './egress.mjs';
import { readForm, readJson } from './http.mjs';
import { resolveAndValidate } from '../../plugins/_net.mjs';

export const CODE_MINUTES = 10;
export const ACCESS_HOURS = 1;
export const REFRESH_DAYS = 30;
export const FRESH_SIGN_IN_MS = 10 * 60_000;
const REQUEST_MINUTES = 10;
const METADATA_CACHE_MS = 60 * 60_000;
const METADATA_MAX_BYTES = 64 * 1024;
const METADATA_TIMEOUT_MS = 5000;
const SCOPE = 'mcp';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const later = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------------------------------------------------------------- redirect URIs

/** https, or http on a loopback host. No fragments, no credentials. */
export function validRedirectUri(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

// ---------------------------------------------------------------- client metadata documents

/** The pinned fetch: resolve and validate the host once, then connect to exactly those addresses. */
async function guardedGetJson(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new OAuthError('invalid_client', 'A client metadata URL must be https.');
  if (url.username || url.password || url.hash) throw new OAuthError('invalid_client', 'The client metadata URL can\'t carry credentials or a fragment.');
  let addrs;
  try { addrs = await resolveAndValidate(url.hostname); } catch (e) {
    throw new OAuthError('invalid_client', `The client metadata host isn't reachable from here (${e.message.replace(/^plugin egress:?\s*/, '')}).`);
  }
  return new Promise((resolve, reject) => {
    const fail = (msg) => reject(new OAuthError('invalid_client', msg));
    const req = httpsRequest({
      host: url.hostname, servername: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'shukatsu-oauth' }, timeout: METADATA_TIMEOUT_MS,
      lookup: (_host, opts, cb) => (opts?.all ? cb(null, addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))) : cb(null, addrs[0], addrs[0].includes(':') ? 6 : 4)),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return fail(`The client metadata URL answered ${res.statusCode}.`); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > METADATA_MAX_BYTES) { req.destroy(); fail('The client metadata document is too large.'); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch { fail('The client metadata document isn\'t valid JSON.'); }
      });
    });
    req.on('timeout', () => { req.destroy(); fail('The client metadata URL took too long to answer.'); });
    req.on('error', (e) => fail(`The client metadata URL couldn't be fetched (${e.code || e.message}).`));
    req.end();
  });
}

let fetchDocument = guardedGetJson;
/** Tests swap the network out. Pass nothing to restore the guarded fetch. */
export const setMetadataFetcher = (fn) => { fetchDocument = fn || guardedGetJson; };

const cleanName = (s, fallback) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback;

function checkedMetadata(doc, clientId) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new OAuthError('invalid_client_metadata', 'The client metadata isn\'t a JSON object.');
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && validRedirectUri(u))) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list one to ten https or loopback http URIs, with no fragment.');
  }
  const method = doc.token_endpoint_auth_method;
  if (method != null && method !== 'none') throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method none) are supported.');
  const types = doc.grant_types;
  if (types != null && (!Array.isArray(types) || !types.every((g) => ['authorization_code', 'refresh_token'].includes(g)))) {
    throw new OAuthError('invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token.');
  }
  let fallback = 'An MCP client';
  try { fallback = new URL(clientId).hostname; } catch {}
  return { name: cleanName(doc.client_name, fallback), redirect_uris: [...uris] };
}

const isUrlId = (id) => /^https:\/\//i.test(id);

/** Whether a client_id is shaped like a client metadata document URL (https, with a path). */
export function metadataUrlOk(id) {
  try { const u = new URL(id); return u.protocol === 'https:' && u.pathname.length > 1 && !u.hash && !u.username && !u.password; } catch { return false; }
}

/**
 * A client by id: `{ client_id, kind, name, redirect_uris }`. A URL id is a
 * metadata document, fetched (guarded) and cached for an hour. Anything else
 * is a dynamically registered client.
 */
export async function resolveClient(root, clientId) {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 2048) throw new OAuthError('invalid_client', 'Unknown client.', 401);
  const d = db(root);
  const row = d.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
  if (!isUrlId(clientId)) {
    if (!row || row.kind !== 'registered') throw new OAuthError('invalid_client', 'Unknown client.', 401);
    const meta = JSON.parse(row.metadata);
    return { client_id: clientId, kind: 'registered', name: row.name || meta.client_name, redirect_uris: meta.redirect_uris };
  }
  if (!metadataUrlOk(clientId)) throw new OAuthError('invalid_client', 'A client metadata URL must be https and have a path.', 401);
  if (row?.kind === 'metadata' && Date.now() - Date.parse(row.created_at) < METADATA_CACHE_MS) {
    return { client_id: clientId, kind: 'metadata', name: row.name, redirect_uris: JSON.parse(row.metadata).redirect_uris };
  }
  // The one request the daemon makes on a client's word: a GET of its public metadata document, carrying nothing of ours.
  const line = { actor: 'oauth', purpose: 'client.metadata', host: new URL(clientId).hostname, method: 'GET', sent_chars: 0 };
  const started = Date.now();
  let doc;
  try {
    doc = await fetchDocument(clientId);
    logEgress(root, { ...line, status: 200, ms: Date.now() - started });
  } catch (e) {
    logEgress(root, { ...line, status: 'error', ms: Date.now() - started });
    throw e;
  }
  if (doc?.client_id !== clientId) throw new OAuthError('invalid_client_metadata', 'The document\'s client_id must equal the URL it was served from.', 401);
  const meta = checkedMetadata(doc, clientId);
  d.prepare(`INSERT INTO oauth_clients (client_id, kind, name, metadata, created_at) VALUES (?, 'metadata', ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, metadata = excluded.metadata, created_at = excluded.created_at`)
    .run(clientId, meta.name, JSON.stringify({ redirect_uris: meta.redirect_uris }), now());
  return { client_id: clientId, kind: 'metadata', name: meta.name, redirect_uris: meta.redirect_uris };
}

/** RFC 7591 registration. Public clients only, a handful of redirect URIs, and unused ones expire. */
export function registerClient(root, body) {
  if (!body || typeof body !== 'object') throw new OAuthError('invalid_client_metadata', 'Send a JSON object.');
  const meta = checkedMetadata({ ...body, token_endpoint_auth_method: body.token_endpoint_auth_method === undefined ? 'none' : body.token_endpoint_auth_method }, 'registered');
  const d = db(root);
  d.prepare(`DELETE FROM oauth_clients WHERE kind = 'registered' AND last_used_at IS NULL AND created_at < ?`).run(new Date(Date.now() - 30 * 24 * 3600_000).toISOString());
  if (d.prepare(`SELECT COUNT(*) AS n FROM oauth_clients WHERE kind = 'registered'`).get().n >= 500) throw new OAuthError('invalid_client_metadata', 'Too many registered clients. Try again later.', 429);
  const clientId = `shk_client_${randomBytes(16).toString('base64url')}`;
  const issued = now();
  d.prepare(`INSERT INTO oauth_clients (client_id, kind, name, metadata, created_at) VALUES (?, 'registered', ?, ?, ?)`)
    .run(clientId, meta.name, JSON.stringify({ redirect_uris: meta.redirect_uris, client_name: meta.name }), issued);
  return {
    client_id: clientId, client_id_issued_at: Math.floor(Date.parse(issued) / 1000), client_name: meta.name, redirect_uris: meta.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE,
  };
}

// ---------------------------------------------------------------- pending requests

// A pending request is the checked authorize parameters, signed, so the consent
// page can carry it in a URL without a table and without anything secret in it.
const signingKey = (root) => {
  let key = getSetting(root, 'oauth.signing_key');
  if (!key) { key = randomBytes(32).toString('base64url'); setSetting(root, 'oauth.signing_key', key); }
  return key;
};
const sign = (root, payload) => b64(createHmac('sha256', signingKey(root)).update(payload).digest());

function seal(root, data) {
  const payload = b64(JSON.stringify(data));
  return `${payload}.${sign(root, payload)}`;
}

function unseal(root, request) {
  const [payload, sig, extra] = String(request || '').split('.');
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, sign(root, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

/** The resource identifier of the MCP endpoint on this install. */
export const resourceUrl = (baseUrl) => `${baseUrl}/mcp`;

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

/**
 * Check an authorization request and, if it's sound, return the signed request
 * id for the consent page. A bad client or redirect_uri is an error to show the
 * person (never a redirect, since the URI can't be trusted). Everything after
 * that is reported to the redirect_uri, which is why `redirect` is on the error.
 */
export async function startAuthorization(root, params, { baseUrl }) {
  const client = await resolveClient(root, params.client_id);
  const redirectUri = params.redirect_uri;
  if (!redirectUri) {
    if (client.redirect_uris.length !== 1) throw new OAuthError('invalid_request', 'redirect_uri is required.');
  } else if (!client.redirect_uris.includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'redirect_uri doesn\'t match one the client registered.');
  }
  const uri = redirectUri || client.redirect_uris[0];
  const bounce = (error, description) => Object.assign(new OAuthError(error, description), { redirect: uri, state: params.state });
  if (params.response_type !== 'code') throw bounce('unsupported_response_type', 'Only response_type=code is supported.');
  if (!PKCE_CHALLENGE.test(params.code_challenge || '')) throw bounce('invalid_request', 'A PKCE code_challenge is required.');
  if (params.code_challenge_method !== 'S256') throw bounce('invalid_request', 'code_challenge_method must be S256.');
  if (params.resource && params.resource !== resourceUrl(baseUrl)) throw bounce('invalid_target', `resource must be ${resourceUrl(baseUrl)}.`);
  const scopes = String(params.scope || SCOPE).split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== SCOPE)) throw bounce('invalid_scope', `Only the ${SCOPE} scope is supported.`);
  return seal(root, {
    c: client.client_id, r: uri, h: params.code_challenge, s: params.state ?? null, sc: SCOPE, rs: resourceUrl(baseUrl), exp: Date.now() + REQUEST_MINUTES * 60_000,
  });
}

/** A pending request as the consent page shows it: the client, the redirect host, nothing secret. Null when it's bad or expired. */
export async function readPending(root, request) {
  const data = unseal(root, request);
  if (!data) return null;
  let client;
  try { client = await resolveClient(root, data.c); } catch { return null; }
  if (!client.redirect_uris.includes(data.r)) return null;
  const u = new URL(data.r);
  return { client_id: client.client_id, client_name: client.name, client_host: isUrlId(client.client_id) ? new URL(client.client_id).host : null, redirect_host: u.host, redirect_loopback: u.protocol === 'http:', expires_at: new Date(data.exp).toISOString() };
}

const redirectWith = (uri, params) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
};

/** Whether this session signed in recently enough to give access. */
export const freshSession = (user) => Boolean(user?.session?.created_at) && Date.now() - Date.parse(user.session.created_at) <= FRESH_SIGN_IN_MS;

/**
 * The stamp: the owner, signed in by session within ten minutes, gives the
 * client the identity of one agent. Returns where to send the browser.
 */
export function grant(root, { owner, requestId, agentId }) {
  if (!owner || owner.kind !== 'person' || owner.role !== 'owner' || owner.disabled_at) throw new OAuthError('access_denied', 'Only the owner can give a client access.', 403);
  if (!freshSession(owner)) throw new OAuthError('login_required', 'Sign in again to give access.', 403);
  const data = unseal(root, requestId);
  if (!data) throw new OAuthError('invalid_request', 'That request expired. Start again from the client.');
  const agent = getUser(root, Number(agentId));
  if (!agent || agent.kind !== 'agent' || agent.disabled_at) throw new OAuthError('invalid_request', 'Pick an agent identity that is still active.');
  const client = db(root).prepare('SELECT name FROM oauth_clients WHERE client_id = ?').get(data.c);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client.', 401);
  const code = randomBytes(32).toString('base64url');
  db(root).prepare(`INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, granted_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256(code), data.c, agent.id, data.r, data.h, data.sc, data.rs, owner.id, now(), later(CODE_MINUTES));
  logActivity(root, { actor: owner, verb: 'oauth.granted', subject: `person:${agent.id}`, detail: { client: client.name, agent: agent.name } });
  return { redirect: redirectWith(data.r, { code, state: data.s }) };
}

/** The owner declined: send the client back with access_denied. */
export function deny(root, { requestId }) {
  const data = unseal(root, requestId);
  if (!data) throw new OAuthError('invalid_request', 'That request expired. Start again from the client.');
  return { redirect: redirectWith(data.r, { error: 'access_denied', state: data.s }) };
}

// ---------------------------------------------------------------- tokens

/** A new access token and the refresh token that renews it (revoking the access token revokes both). */
const pair = (root, { userId, client }) => {
  const access = issueToken(root, { actor: null, userId, kind: 'oauth', name: client.name, days: ACCESS_HOURS / 24, clientId: client.client_id });
  const refresh = issueToken(root, { actor: null, userId, kind: 'refresh', name: client.name, days: REFRESH_DAYS, clientId: client.client_id, parentId: access.id });
  return {
    access_token: access.token, token_type: 'Bearer', expires_in: ACCESS_HOURS * 3600, refresh_token: refresh.token, scope: SCOPE,
  };
};

/** The token endpoint's work: authorization_code and refresh_token grants. */
export async function exchange(root, form, { baseUrl }) {
  const client = await resolveClient(root, form.client_id);
  if (form.resource && form.resource !== resourceUrl(baseUrl)) throw new OAuthError('invalid_target', `resource must be ${resourceUrl(baseUrl)}.`);
  const d = db(root);

  if (form.grant_type === 'authorization_code') {
    const verifier = String(form.code_verifier || '');
    if (!form.code || !PKCE_VERIFIER.test(verifier)) throw new OAuthError('invalid_request', 'code and a PKCE code_verifier are required.');
    const row = d.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha256(String(form.code)));
    if (!row || row.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'That code is invalid.');
    // Spend it before anything else can fail, so a replay or a wrong verifier can't be retried.
    const spent = d.prepare('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(now(), row.code_hash);
    if (!spent.changes) throw new OAuthError('invalid_grant', 'That code was already used.');
    if (row.expires_at <= now()) throw new OAuthError('invalid_grant', 'That code expired.');
    if (form.redirect_uri !== row.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri doesn\'t match the authorization request.');
    if (!safeEqual(b64(createHash('sha256').update(verifier).digest()), row.code_challenge)) throw new OAuthError('invalid_grant', 'The code_verifier doesn\'t match.');
    const agent = getUser(root, row.user_id);
    if (!agent || agent.disabled_at) throw new OAuthError('invalid_grant', 'That identity is disabled.');
    d.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').run(now(), client.client_id);
    return pair(root, { userId: agent.id, client });
  }

  if (form.grant_type === 'refresh_token') {
    const raw = String(form.refresh_token || '');
    const hit = tokenUser(root, raw, { kinds: ['refresh'] });
    if (!hit || hit.token.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'That refresh token is invalid, expired, or was already used.');
    const used = consumeRefresh(root, raw);
    if (!used) throw new OAuthError('invalid_grant', 'That refresh token is invalid, expired, or was already used.');
    d.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').run(now(), client.client_id);
    return pair(root, { userId: used.user.id, client });
  }

  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

/** RFC 7009: revoke an access or refresh token the client holds. Unknown tokens are not an error. */
export function revoke(root, { token, client_id }) {
  const raw = String(token || '');
  const hit = tokenUser(root, raw, { kinds: ['oauth', 'refresh'] });
  if (!hit) return;
  if (client_id && hit.token.client_id !== client_id) return;
  revokeToken(root, { actor: null, id: hit.token.id });
}

// ---------------------------------------------------------------- http

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version' };

export const authorizationServerMetadata = (baseUrl) => ({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/oauth/authorize`,
  token_endpoint: `${baseUrl}/oauth/token`,
  registration_endpoint: `${baseUrl}/oauth/register`,
  revocation_endpoint: `${baseUrl}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [SCOPE],
  client_id_metadata_document_supported: true,
});

export const protectedResourceMetadata = (baseUrl) => ({
  resource: resourceUrl(baseUrl),
  authorization_servers: [baseUrl],
  bearer_methods_supported: ['header'],
  scopes_supported: [SCOPE],
  resource_name: 'shukatsu',
});

const page = (title, message) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.4rem">${title}</h1><p>${message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</p></body>`;

const oauthJson = (ctx, status, body, extra = {}) => ctx.json(status, body, { ...CORS, Pragma: 'no-cache', ...extra });
const oauthFail = (ctx, e) => {
  if (!(e instanceof OAuthError)) {
    const status = e?.status && e.status < 500 ? e.status : 500;
    return oauthJson(ctx, status, { error: status === 500 ? 'server_error' : 'invalid_request', error_description: status === 500 ? 'Something went wrong.' : e.message });
  }
  return oauthJson(ctx, e.status, { error: e.error, error_description: e.message }, e.status === 401 ? { 'WWW-Authenticate': 'Basic realm="shukatsu"' } : {});
};

/** The OAuth routes. Returns false when the path isn't one of them. */
export async function handleOAuth(req, res, ctx) {
  const url = new URL(req.url, ctx.baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const known = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp',
    '/oauth/authorize', '/oauth/token', '/oauth/register', '/oauth/revoke'];
  if (!known.includes(path)) return false;

  if (req.method === 'OPTIONS') { ctx.send(204, '', CORS); return true; }

  if (path.startsWith('/.well-known/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { ctx.json(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD, OPTIONS' }); return true; }
    const doc = path === '/.well-known/oauth-authorization-server' ? authorizationServerMetadata(ctx.baseUrl) : protectedResourceMetadata(ctx.baseUrl);
    ctx.json(200, doc, { ...CORS, 'Cache-Control': 'public, max-age=300' });
    return true;
  }

  if (path === '/oauth/authorize') {
    if (req.method !== 'GET') { ctx.json(405, { error: 'method_not_allowed' }, { Allow: 'GET' }); return true; }
    if (ctx.limited(`oauth-authorize:${ctx.ip}`, 60, 60_000)) { ctx.send(429, page('Slow down', 'Too many requests. Try again in a minute.'), { 'Content-Type': 'text/html; charset=utf-8' }); return true; }
    const params = Object.fromEntries(url.searchParams);
    try {
      const request = await startAuthorization(ctx.root, params, { baseUrl: ctx.baseUrl });
      ctx.send(302, '', { Location: `/oauth/consent?request=${encodeURIComponent(request)}` });
    } catch (e) {
      if (e instanceof OAuthError && e.redirect) {
        ctx.send(302, '', { Location: redirectWith(e.redirect, { error: e.error, error_description: e.message, state: e.state }) });
      } else {
        const msg = e instanceof OAuthError ? e.message : 'The request couldn\'t be checked.';
        ctx.send(e instanceof OAuthError ? 400 : 500, page('This request can\'t continue', msg), { 'Content-Type': 'text/html; charset=utf-8' });
      }
    }
    return true;
  }

  if (req.method !== 'POST') { ctx.json(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' }); return true; }

  try {
    if (path === '/oauth/register') {
      if (ctx.limited(`oauth-register:${ctx.ip}`, 10, 3600_000)) {
        oauthJson(ctx, 429, { error: 'rate_limited', error_description: 'Too many registrations. Try again later.' });
        return true;
      }
      oauthJson(ctx, 201, registerClient(ctx.root, await readJson(ctx, 32_000)));
      return true;
    }
    if (ctx.limited(`oauth-token:${ctx.ip}`, 60, 60_000)) { oauthJson(ctx, 429, { error: 'rate_limited', error_description: 'Too many requests. Try again in a minute.' }); return true; }
    const form = await readForm(ctx);
    if (path === '/oauth/token') {
      oauthJson(ctx, 200, await exchange(ctx.root, form, { baseUrl: ctx.baseUrl }));
      return true;
    }
    revoke(ctx.root, form);
    oauthJson(ctx, 200, {});
  } catch (e) {
    oauthFail(ctx, e);
  }
  return true;
}
