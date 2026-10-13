/**
 * The small HTTP toolkit the daemon's own routes share (/api, /mcp, /oauth,
 * /cal, /connectors): one context object per request, so each handler is a
 * plain (req, res, ctx) function that tests can call without a server.
 *
 *   ctx.root          the data root
 *   ctx.baseUrl       the public origin (SHUKATSU_URL, else the request's)
 *   ctx.ip            the client address (the tunnel's header only behind a proxy)
 *   ctx.local         true for a request from this machine with no proxy in between
 *   ctx.sessionUser() the person signed in by the app's session cookie, or null
 *   ctx.bearer()      the raw bearer token, or null
 *   ctx.body(limit)   the request body as a Buffer (rejects past `limit` bytes)
 *   ctx.json(status, value, headers)   send JSON
 *   ctx.send(status, body, headers)    send anything
 *   ctx.limited(key, max, windowMs)    true when `key` is past its rate limit
 */

import { sessionUser } from './people.mjs';

export const SESSION_COOKIE = 'shk_session';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Whether a proxy or tunnel stands between the client and us. */
const proxied = (req) => Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']);

export function clientIp(req) {
  if (proxied(req) && LOOPBACK.test(req.socket?.remoteAddress || '')) {
    return String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip']).trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function isLocal(req) {
  return LOOPBACK.test(req.socket?.remoteAddress || '') && !proxied(req);
}

export function originOf(req) {
  if (process.env.SHUKATSU_URL) return new URL(process.env.SHUKATSU_URL).origin;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`;
}

// In-memory windows: enough for one process, and a restart forgiving a burst is fine.
const windows = new Map();
export function limited(key, max, windowMs) {
  const t = Date.now();
  const w = windows.get(key);
  if (!w || t - w.start > windowMs) { windows.set(key, { start: t, n: 1 }); return false; }
  w.n++;
  if (windows.size > 10_000) for (const [k, v] of windows) if (t - v.start > windowMs) windows.delete(k);
  return w.n > max;
}

export function makeCtx(req, res, { root }) {
  const ctx = {
    root,
    baseUrl: originOf(req),
    ip: clientIp(req),
    local: isLocal(req),
    sessionUser: () => {
      const token = cookies(req)[SESSION_COOKIE];
      return token ? sessionUser(root, token) : null;
    },
    bearer: () => {
      const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
      return m ? m[1] : null;
    },
    body: (limit = 1_000_000) => new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(Object.assign(new Error('The request body is too large.'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    }),
    send: (status, body, headers = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(body);
    },
    json: (status, value, headers = {}) => ctx.send(status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers }),
    limited: (key, max, windowMs) => limited(key, max, windowMs),
  };
  return ctx;
}

/** Read a JSON body, or throw a 400 a person can read. */
export async function readJson(ctx, limit) {
  const raw = (await ctx.body(limit)).toString('utf-8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('The body isn\'t valid JSON.'), { status: 400, code: 'invalid_json' }); }
}

/** Read an application/x-www-form-urlencoded body (OAuth's token endpoint speaks it). */
export async function readForm(ctx, limit = 64_000) {
  return Object.fromEntries(new URLSearchParams((await ctx.body(limit)).toString('utf-8')));
}
