#!/usr/bin/env node

/**
 * shukatsud: the system, as one process on one port.
 *
 *   node shukatsu/shukatsud.mjs                 production (after `npm run build`)
 *   node shukatsu/shukatsud.mjs --dev           development, with the app's hot reload
 *   options: --port 3000 --host 127.0.0.1 --no-sync
 *
 * It mounts the web app (Next's request handler) and beside it the routes
 * that don't belong to a page: /api/v1 (the registry over JSON), /mcp (agents),
 * /oauth and /.well-known (remote MCP clients), /cal (calendar feeds), and
 * /connectors (OAuth callbacks for mail and calendar). Every one of them, and
 * every server action in the app, runs through the operations registry in
 * core/ops, in this process, so there is one writer and one door.
 *
 * It also runs the scheduler: connector sync once a minute (each connector
 * decides what is due). A sleeping laptop just misses ticks; the cursors in
 * sync.db catch up on wake.
 *
 * On a fresh install with no owner, it prints a one-time setup link. Once the
 * owner exists it keeps the owner's terminal token in .shukatsu/owner.token
 * (0600), which is how the CLIs reach the API.
 */

import { createServer } from 'http';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { createInvite, hasOwner, owner as ownerOf, issueToken, tokenUser } from './core/people.mjs';
import { db } from './core/store.mjs';
import { loadProfile } from './core/facts.mjs';
import { stateDir } from './core/lock.mjs';
import { makeCtx } from './core/http.mjs';
import { handleApi } from './core/api.mjs';
import { handleCal } from './core/cal.mjs';
import { register } from './core/ops/index.mjs';
import { addBusySource } from './core/ops/schedule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const out = { dev: false, port: Number(process.env.PORT) || 3000, host: process.env.HOST || '127.0.0.1', sync: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dev') out.dev = true;
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--host') out.host = argv[++i];
    else if (argv[i] === '--no-sync') out.sync = false;
  }
  return out;
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** A module another part of the build provides, when it's there. */
async function optional(rel) {
  const path = join(HERE, rel);
  if (!existsSync(path)) return null;
  return import(pathToFileURL(path).href);
}

export const OWNER_TOKEN = (root) => join(stateDir(root), 'owner.token');

/** First run: a setup link. Later: the owner's terminal token, kept fresh in a 0600 file. */
function firstRun(root, base) {
  if (!hasOwner(root)) {
    // The raw token of an earlier link isn't kept, so each start without an owner makes a new one.
    db(root).prepare("UPDATE invites SET revoked_at = ? WHERE role = 'owner' AND used_at IS NULL AND revoked_at IS NULL").run(new Date().toISOString());
    // The invite carries the candidate's name from the record, so the account isn't called "Candidate".
    let name = 'Candidate';
    try { name = loadProfile(root).candidate?.name || name; } catch {}
    const token = createInvite(root, { actor: null, role: 'owner', name, days: 1 });
    log(`No account yet. Open this within 24 hours to create the candidate's account:\n\n    ${base}/invite/${token}\n`);
    return;
  }
  const file = OWNER_TOKEN(root);
  const current = existsSync(file) ? readFileSync(file, 'utf-8').trim() : '';
  if (current && tokenUser(root, current, { kinds: ['cli'] })) return;
  const me = ownerOf(root);
  const { token } = issueToken(root, { actor: me, userId: me.id, kind: 'cli', name: 'terminal (owner.token)' });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  log(`Wrote the owner's terminal token to ${file}.`);
}

export async function start(opts = args(process.argv.slice(2))) {
  // shukatsu/.env, read the way `next start` reads it, before anything looks at SHUKATSU_URL or the data root.
  const { default: env } = await import('@next/env');
  env.loadEnvConfig(HERE, opts.dev);
  const root = getCareerOpsRoot();
  if (!existsSync(join(root, 'data', 'career-profile.yml'))) {
    throw new Error(`No master profile under ${root}. Point .career-ops-data or CAREER_OPS_DATA_DIR at the data root.`);
  }
  process.env.SHUKATSU_ENGINE ??= dirname(HERE);
  const base = (process.env.SHUKATSU_URL || `http://localhost:${opts.port}`).replace(/\/$/, '');

  const [oauth, mcp, connectors] = await Promise.all([optional('core/oauth.mjs'), optional('core/mcp.mjs'), optional('connectors/index.mjs')]);
  if (connectors?.boot) {
    try { await connectors.boot(root, { register, addBusySource }); } catch (e) { log('connectors failed to start:', e.message); }
  }

  // Next sends anonymous usage data to Vercel unless told not to. This system sends nothing home (DATAFLOW.md).
  process.env.NEXT_TELEMETRY_DISABLED ??= '1';
  const { default: next } = await import('next');
  const app = next({ dev: opts.dev, dir: HERE, hostname: opts.host, port: opts.port });
  const nextHandle = app.getRequestHandler();
  await app.prepare();

  const routes = [
    handleApi,
    handleCal,
    ...(oauth?.handleOAuth ? [oauth.handleOAuth] : []),
    ...(mcp?.handleMcp ? [(req, res, ctx) => (new URL(req.url, 'http://x').pathname === '/mcp' ? mcp.handleMcp(req, res, ctx).then(() => true) : false)] : []),
    ...(connectors?.handleConnector ? [connectors.handleConnector] : []),
  ];

  const server = createServer(async (req, res) => {
    try {
      const ctx = makeCtx(req, res, { root });
      for (const route of routes) {
        if (await route(req, res, ctx)) return;
      }
      await nextHandle(req, res);
    } catch (e) {
      log('request failed:', req.method, req.url?.split('?')[0], e?.stack || e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Something went wrong.'); }
    }
  });
  // Next's own WebSocket (hot reload in dev) arrives as an upgrade, not a request.
  const upgrade = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => { upgrade(req, socket, head).catch(() => socket.destroy()); });
  await new Promise((resolve) => server.listen(opts.port, opts.host, resolve));
  log(`shukatsu on http://${opts.host}:${opts.port} (${opts.dev ? 'dev' : 'production'}), data root ${root}`);
  log(`routes: app, /api/v1, /cal${oauth ? ', /oauth' : ''}${mcp ? ', /mcp' : ''}${connectors ? ', /connectors' : ''}`);
  firstRun(root, base);

  let timer = null;
  if (opts.sync && connectors?.syncDue) {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await connectors.syncDue(root); } catch (e) { log('sync tick failed:', e.message); } finally { busy = false; }
    };
    timer = setInterval(tick, 60_000);
    timer.unref();
    setTimeout(tick, 5_000).unref();
  }

  // A machine short of memory pages out a daemon that sat idle for hours, and the
  // first request after that can take half a minute: long enough for someone who
  // opened a link from LINE to give up. Once the app has a public address, render
  // the sign-in page every few minutes so it stays resident. The request goes to
  // this process over loopback and never leaves the machine.
  let warm = null;
  if (!opts.dev && /^https:\/\//.test(base) && !/^https:\/\/(localhost|127\.)/.test(base)) {
    const host = opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host;
    warm = setInterval(() => { fetch(`http://${host}:${opts.port}/login`).then((r) => r.arrayBuffer()).catch(() => {}); }, 4 * 60_000);
    warm.unref();
  }

  const stop = () => {
    log('stopping');
    if (timer) clearInterval(timer);
    if (warm) clearInterval(warm);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((e) => { console.error(`shukatsud: ${e.message}`); process.exit(1); });
}
