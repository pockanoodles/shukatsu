/**
 * The connector layer: how outside data gets into sync.db.
 *
 *   connectors/<id>/manifest.json   id, capabilities, auth kind, allowed hosts
 *   connectors/<id>/index.mjs       sync(account, cursor, ctx) -> { records, cursor }
 *
 * This file is what the daemon calls:
 *
 *   boot(root, { register, addBusySource })   once, at start
 *   syncDue(root)                             every minute; runs what is due, never throws
 *   syncNow(root, accountId)                  one account now (the Sync button)
 *   handleConnector(req, res, ctx)            /connectors/{id}/start|callback, false if not ours
 *
 * Every request a connector makes goes through ctx.mjs's guarded fetch, pinned
 * to the manifest's hosts and written to egress.log. After each sync the
 * signals step (signals.mjs) reads what arrived. A push connector (the
 * browser extension, manifest `push: true`) fetches nothing: what it keeps
 * arrives through its own operation, and the scheduler never runs it.
 */

import { readFileSync } from 'fs';
import { can } from '../core/people.mjs';
import {
  addAccount, getAccount, getCursor, getSecret, hasRecord, listAccounts, markAttempt, pruneRecords,
  removeAccount, setCursor, setSecret, syncDb, updateAccount, upsertRecords,
} from '../core/sync.mjs';
import { makeConnectorCtx } from './ctx.mjs';
import { processRecords } from './signals.mjs';
import * as browser from './browser/index.mjs';
import * as gmail from './gmail/index.mjs';
import * as icsIn from './ics-in/index.mjs';

const manifestOf = (id) => JSON.parse(readFileSync(new URL(`./${id}/manifest.json`, import.meta.url), 'utf-8'));

const MODULES = {
  'ics-in': { ...icsIn, manifest: manifestOf('ics-in') },
  gmail: { ...gmail, manifest: manifestOf('gmail') },
  browser: { ...browser, manifest: manifestOf('browser') },
};

export const CONNECTORS = Object.values(MODULES).map((m) => m.manifest);
export const connectorIds = () => Object.keys(MODULES);
export const manifestFor = (id) => MODULES[id]?.manifest || null;
export const callbackPath = (id) => `/connectors/${id}/callback`;

const fail = (message, code, status) => Object.assign(new Error(message), { code, status });

/** Settings, secret, and status for an account from what the settings form sent. `previous` is { settings, secret } when updating. */
export function prepareAccount(connector, input, previous = null) {
  const mod = MODULES[connector];
  if (!mod) throw fail(`There is no connector called ${connector}.`, 'not_found', 404);
  try {
    return mod.prepare(input, previous);
  } catch (e) {
    throw fail(e.message, 'invalid_input', 400);
  }
}

/** Create an account from form input. */
export function createAccount(root, connector, input) {
  const { settings, secret, status } = prepareAccount(connector, input);
  return addAccount(root, { connector, label: input.label?.trim() || MODULES[connector].manifest.name, settings, secret, status });
}

/** Change an account. Only the fields given change. */
export function changeAccount(root, id, input) {
  const account = getAccount(root, id);
  if (!account) throw fail('No such account.', 'not_found', 404);
  const touched = ['url', 'client_id', 'client_secret', 'timezone', 'lookback_days'].some((k) => input[k] !== undefined);
  if (touched) {
    const next = prepareAccount(account.connector, input, { settings: account.settings, secret: getSecret(root, id) });
    updateAccount(root, id, { settings: next.settings, ...(next.status ? { status: next.status } : {}) });
    setSecret(root, id, next.secret);
  }
  if (input.label !== undefined) updateAccount(root, id, { label: input.label.trim() || account.label });
  if (input.paused !== undefined) {
    updateAccount(root, id, { status: input.paused ? 'paused' : getSecret(root, id)?.refresh_token === null ? 'needs_auth' : 'ok' });
  }
  return getAccount(root, id);
}

export { removeAccount };

// ---------------------------------------------------------------- sync

const inflight = new Set();

/** An error message with any credential the account holds taken out, since it may be shown on the settings page. */
function redact(message, secret) {
  let out = String(message);
  const walk = (v) => {
    if (typeof v === 'string' && v.length >= 6) out = out.split(v).join('«hidden»');
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(secret);
  return out;
}

/**
 * Sync one account now. Resolves to { ok, records, added, signals } or
 * { ok: false, error }, and records the outcome on the account either way.
 * `fetch` replaces the network (recorded tests).
 */
export async function syncNow(root, accountId, { fetch = null } = {}) {
  const account = getAccount(root, accountId);
  if (!account) throw fail('No such account.', 'not_found', 404);
  const mod = MODULES[account.connector];
  if (!mod) throw fail(`There is no connector called ${account.connector}.`, 'not_found', 404);
  const key = `${root}:${accountId}`;
  if (inflight.has(key)) return { ok: false, error: 'This account is already syncing.' };
  if (mod.manifest.push) return { ok: true, records: 0, added: 0, signals: processRecords(root).length };
  inflight.add(key);
  let secret = null;
  try {
    secret = getSecret(root, accountId);
    const live = { ...account, secret };
    const ctx = makeConnectorCtx(root, mod.manifest, account, {
      fetch,
      extra: {
        now: () => Date.now(),
        has: (externalId) => hasRecord(root, accountId, externalId),
        saveSecret: (next) => { setSecret(root, accountId, next); live.secret = next; secret = next; },
      },
    });
    const out = await mod.sync(live, getCursor(root, accountId), ctx);
    const kept = upsertRecords(root, accountId, out.records || []);
    if (out.prune) pruneRecords(root, accountId, out.prune, (out.records || []).map((r) => r.external_id));
    if (out.cursor !== undefined) setCursor(root, accountId, out.cursor);
    const signals = processRecords(root);
    markAttempt(root, accountId, { ok: true });
    return { ok: true, records: kept.length, added: kept.filter((r) => r.isNew).length, signals: signals.length };
  } catch (e) {
    const error = redact(e?.message || e, secret);
    markAttempt(root, accountId, { ok: false, error, status: e?.code === 'needs_auth' ? 'needs_auth' : null });
    return { ok: false, error };
  } finally {
    inflight.delete(key);
  }
}

/** Run every account that is due. Never throws: a broken feed is a last_error on its account, not a crashed daemon. */
export async function syncDue(root, { fetch = null, nowMs = Date.now() } = {}) {
  const results = [];
  try {
    for (const a of listAccounts(root)) {
      if (a.status === 'paused' || a.status === 'needs_auth') continue;
      const mod = MODULES[a.connector];
      if (!mod || mod.manifest.push) continue;
      // A failing account backs off: one more interval per failure, up to seven.
      const every = (mod.manifest.intervalMinutes || 60) * 60_000 * (1 + Math.min(a.fail_count, 6));
      const last = a.last_attempt_at ? Date.parse(a.last_attempt_at) : 0;
      if (nowMs - last < every) continue;
      results.push({ account: a.id, ...(await syncNow(root, a.id, { fetch })) });
    }
  } catch (e) {
    console.error(`shukatsu: connector sync failed: ${e?.message || e}`);
  }
  return results;
}

const registered = new WeakSet();

/**
 * Start-up: open sync.db, give calendar.conflicts the connected feeds as busy
 * time, and register any operations a connector brings.
 */
export async function boot(root, { register = null, addBusySource = null } = {}) {
  syncDb(root);
  if (addBusySource && !registered.has(addBusySource)) {
    registered.add(addBusySource);
    addBusySource(async (r, window) => icsIn.busyTimes(r, window));
  }
  if (register) for (const m of Object.values(MODULES)) if (m.ops?.length) register(m.ops);
}

// ---------------------------------------------------------------- routes

const back = (ctx, query) => ctx.send(302, '', { Location: `/settings/connectors?${new URLSearchParams(query)}` });

/**
 * /connectors/gmail/start?account=ID sends the owner to Google, and
 * /connectors/gmail/callback receives the code. Both need the owner signed in
 * by session, because connecting an account is a stamp. Returns false for
 * any other path so the daemon can try its next route.
 */
export async function handleConnector(req, res, ctx, { fetch = null } = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  const m = url.pathname.match(/^\/connectors\/([\w-]+)\/(start|callback)\/?$/);
  if (!m || m[1] !== 'gmail' || req.method !== 'GET') return false;
  const user = ctx.sessionUser();
  if (!user) { ctx.send(302, '', { Location: '/login' }); return true; }
  if (!can(user, 'connector.manage')) { ctx.send(403, 'Only the owner can connect an account.', { 'Content-Type': 'text/plain; charset=utf-8' }); return true; }
  const redirectUri = `${ctx.baseUrl}${callbackPath('gmail')}`;
  try {
    if (m[2] === 'start') {
      const id = Number(url.searchParams.get('account'));
      ctx.send(302, '', { Location: gmail.beginAuth(ctx.root, id, redirectUri) });
      return true;
    }
    const error = url.searchParams.get('error');
    if (error) { back(ctx, { error: `Google said: ${error.slice(0, 80)}` }); return true; }
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!state || !code) { back(ctx, { error: 'Google sent no code.' }); return true; }
    const accounts = listAccounts(ctx.root, { connector: 'gmail' });
    const id = await gmail.completeAuth(ctx.root, { state, code, redirectUri, accounts, fetch });
    syncNow(ctx.root, id, { fetch }).catch(() => {}); // the first look at the mailbox starts now
    back(ctx, { connected: String(id) });
    return true;
  } catch (e) {
    back(ctx, { error: String(e?.message || e).slice(0, 200) });
    return true;
  }
}
