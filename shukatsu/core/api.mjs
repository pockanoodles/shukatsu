/**
 * /api/v1: the operations registry over plain HTTP and JSON, for the CLI,
 * scripts, an iOS Shortcut, and any agent that would rather not speak MCP.
 *
 *   GET  /api/v1/me            who this token is, and what it may call
 *   GET  /api/v1/ops           every operation it may call, with schemas
 *   POST /api/v1/ops/{name}    run one; the body is its input
 *
 * A result is `{ ok: true, result }`; a refusal is `{ ok: false, error:
 * { code, message, details } }` with the status the error carries. Auth is a
 * bearer token. Capture alone also answers cross-origin (the bookmarklet runs
 * on the job board's page), with no cookies, so CORS grants nothing a token
 * doesn't already.
 */

import { OpError, OPS, available, describe, run, tokenPrincipal } from './ops/index.mjs';
import { readJson } from './http.mjs';

const CORS_OPS = new Set(['posting.capture']);
const cors = (origin) => (origin ? {
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin',
} : {});

function principalOf(ctx) {
  const raw = ctx.bearer();
  if (!raw) return null;
  return tokenPrincipal(ctx.root, raw, { ip: ctx.ip, kinds: ['agent', 'cli', 'capture', 'oauth'] });
}

const fail = (ctx, e, headers = {}) => {
  const err = e instanceof OpError ? e : new OpError(e?.code || 'failed', e?.message || String(e), { status: e?.status || 500 });
  ctx.json(err.status || 500, { ok: false, error: err.toJSON() }, headers);
};

export async function handleApi(req, res, ctx) {
  const path = new URL(req.url, 'http://x').pathname;
  if (!path.startsWith('/api/v1/')) return false;
  const opName = (path.match(/^\/api\/v1\/ops\/([a-zA-Z0-9_.]+)$/) || [])[1];
  const crossOrigin = opName && CORS_OPS.has(opName) ? cors(req.headers.origin) : {};

  if (req.method === 'OPTIONS' && opName && CORS_OPS.has(opName)) {
    ctx.send(204, '', crossOrigin);
    return true;
  }
  const principal = principalOf(ctx);
  if (!principal) {
    const slow = ctx.limited(`api-miss:${ctx.ip}`, 20, 15 * 60_000);
    fail(ctx, new OpError('unauthenticated', slow ? 'Too many bad tokens from this address. Wait a while.' : 'Send a token: Authorization: Bearer shk_... (make one on the Agents page).', { status: slow ? 429 : 401 }),
      { ...crossOrigin, 'WWW-Authenticate': 'Bearer realm="shukatsu"' });
    return true;
  }
  if (ctx.limited(`api:${principal.token?.id}`, 600, 60_000)) {
    fail(ctx, new OpError('rate_limited', 'Slow down: at most 600 calls a minute per token.', { status: 429 }), crossOrigin);
    return true;
  }

  try {
    if (req.method === 'GET' && path === '/api/v1/me') {
      const { user } = principal;
      ctx.json(200, { ok: true, result: { id: user.id, name: user.name, kind: user.kind, role: user.role, via: principal.via, token: { kind: principal.token?.kind, name: principal.token?.name, scopes: principal.token?.scopes } } });
      return true;
    }
    if (req.method === 'GET' && path === '/api/v1/ops') {
      ctx.json(200, { ok: true, result: { ops: available(principal).map(describe) } });
      return true;
    }
    if (opName && req.method === 'POST') {
      if (!OPS.has(opName)) throw new OpError('unknown_op', `There is no operation called ${opName}.`, { status: 404 });
      const input = await readJson(ctx, opName === 'posting.capture' ? 1_500_000 : 1_000_000);
      const result = await run(ctx.root, principal, opName, input);
      ctx.json(200, { ok: true, result }, crossOrigin);
      return true;
    }
    throw new OpError('not_found', `Nothing at ${req.method} ${path}.`, { status: 404 });
  } catch (e) {
    fail(ctx, e, crossOrigin);
    return true;
  }
}
