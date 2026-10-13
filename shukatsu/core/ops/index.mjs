/**
 * The operations registry: the one door into shukatsu.
 *
 * Every read and every change the web app, an agent over MCP, the HTTP API,
 * the CLI, or the scheduler makes is an operation here, run through
 * `run(root, principal, name, input)`. Each operation is a plain object:
 *
 *   name        'tracker.setStatus' (area.verb)
 *   kind        'query' | 'command'
 *   summary     one line an agent reads when choosing a tool
 *   permission  checked by people.can(); a string, or (input) => string
 *   stamp       true -> a person signed in by session (or the owner's own
 *               terminal), never a token-borne agent, whatever the role
 *   input       JSON Schema (also the MCP tool's inputSchema)
 *   output      JSON Schema the result is checked against
 *   untrusted   true when the result carries outside text (postings, mail);
 *               that text sits under `untrusted` in the result
 *   agent       false to keep it off the agent surface (MCP and the API)
 *   activity    optional (input, result) => { verb, subject, detail } for
 *               commands whose engine call doesn't log for itself
 *   run         ({ root, actor, principal, input }) => result
 *
 * The rules that used to be instructions for a model (archived JDs, the
 * legitimacy header, canonical states, who may confirm what) are checked by
 * the handlers and the schemas here, so a client that skips a step gets an
 * error naming it instead of writing a bad record.
 */

import { can, getUser, STAMPS, systemAgent, tokenUser } from '../people.mjs';
import { logActivity } from '../store.mjs';
import { validate } from './schema.mjs';

import record from './record.mjs';
import review from './review.mjs';
import postings from './postings.mjs';
import tracker from './tracker.mjs';
import packets from './packets.mjs';
import campaigns from './campaigns.mjs';
import schedule from './schedule.mjs';
import inbox from './inbox.mjs';
import people from './people.mjs';
import connectors from './connectors.mjs';

const AREAS = [record, review, postings, tracker, packets, campaigns, schedule, inbox, people, connectors];

export const OPS = new Map();
for (const op of AREAS.flat()) {
  if (OPS.has(op.name)) throw new Error(`Operation ${op.name} is defined twice.`);
  for (const k of ['name', 'kind', 'summary', 'permission', 'input', 'output', 'run']) {
    if (op[k] == null) throw new Error(`Operation ${op.name || '?'} is missing ${k}.`);
  }
  OPS.set(op.name, Object.freeze({ stamp: false, untrusted: false, agent: true, ...op }));
}

/** Register more operations (connectors add theirs at boot). */
export function register(list) {
  for (const op of list) {
    if (OPS.has(op.name)) throw new Error(`Operation ${op.name} is defined twice.`);
    OPS.set(op.name, Object.freeze({ stamp: false, untrusted: false, agent: true, ...op }));
  }
}

// ---------------------------------------------------------------- errors

/** The one error shape every client sees. `code` is stable; `message` is for a person. */
export class OpError extends Error {
  constructor(code, message, { status = 400, details = null, cause = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    if (cause) this.cause = cause;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const notFound = (what) => new OpError('not_found', `No such ${what}.`, { status: 404 });

// ---------------------------------------------------------------- principals

/**
 * Who is calling. `user` is a users row (a person or an agent); `via` is how
 * they proved it:
 *
 *   session  a browser session cookie (a person who signed in)
 *   token    a bearer token (agents, capture, feeds, OAuth clients)
 *   cli      the owner at their own terminal (direct, or the owner token)
 *   system   the scheduler and connectors, as the install's own agent
 */
export const sessionPrincipal = (user) => ({ user, via: 'session' });
export const cliPrincipal = (user) => ({ user, via: 'cli' });
export const systemPrincipal = (root) => ({ user: systemAgent(root), via: 'system' });

/** The principal for a bearer token, or null. `kinds` limits which token kinds are accepted here. */
export function tokenPrincipal(root, raw, { ip = null, kinds = null } = {}) {
  const hit = tokenUser(root, raw, { ip, kinds });
  if (!hit) return null;
  return { user: hit.user, via: hit.token.kind === 'cli' ? 'cli' : 'token', token: hit.token };
}

const human = (p) => p.user.kind === 'person' && (p.via === 'session' || p.via === 'cli');

/** Whether this principal may call this operation (for listing tools and greying out buttons). */
export function allowed(principal, op) {
  if (!principal?.user || principal.user.disabled_at) return false;
  if (principal.token && !principal.token.scopes.includes('*') && !principal.token.scopes.includes(op.name)) return false;
  if (op.stamp && !human(principal)) return false;
  if (principal.via !== 'session' && principal.via !== 'cli' && op.agent === false) return false;
  const perm = typeof op.permission === 'function' ? null : op.permission;
  return perm == null || perm === 'any' || can(principal.user, perm);
}

/** The operations a principal may call, for MCP's tools/list and the API index. */
export const available = (principal) => [...OPS.values()].filter((op) => allowed(principal, op));

// ---------------------------------------------------------------- run

// Commands run one at a time in this process, so two clients can't interleave
// a read-modify-write of the same file. Queries don't wait.
let tail = Promise.resolve();
const serial = (fn) => {
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
};

function refuse(principal, op, input) {
  const { user } = principal || {};
  if (!user) return new OpError('unauthenticated', 'Sign in first.', { status: 401 });
  if (user.disabled_at) return new OpError('unauthenticated', 'This identity is disabled.', { status: 401 });
  if (principal.token && !principal.token.scopes.includes('*') && !principal.token.scopes.includes(op.name)) {
    return new OpError('scope', `This token can't call ${op.name}.`, { status: 403 });
  }
  if (op.stamp && !human(principal)) {
    return new OpError('stamp_required', `${op.name} is a stamp: it makes something true or final, so the candidate does it signed in, not an agent or a token.`, { status: 403 });
  }
  if (principal.via !== 'session' && principal.via !== 'cli' && op.agent === false) {
    return new OpError('denied', `${op.name} is only available in the app.`, { status: 403 });
  }
  const perm = typeof op.permission === 'function' ? op.permission(input) : op.permission;
  if (perm && perm !== 'any' && !can(user, perm)) {
    return new OpError(STAMPS.has(perm) ? 'stamp_required' : 'denied', STAMPS.has(perm) && user.kind === 'agent'
      ? `${op.name} is a stamp, and agents never stamp. Leave it for the candidate.`
      : 'You do not have permission to do that.', { status: 403 });
  }
  return null;
}

/**
 * Run one operation. Resolves to its result, or rejects with an OpError.
 * Engine errors keep their message (the app translates the common ones) and
 * any `code` they carry.
 */
export async function run(root, principal, name, rawInput = {}) {
  const op = OPS.get(name);
  if (!op) throw new OpError('unknown_op', `There is no operation called ${name}.`, { status: 404 });
  const checked = validate(op.input, rawInput ?? {});
  if (!checked.ok) {
    throw new OpError('invalid_input', `${name}: ${checked.errors.join('; ')}`, { details: checked.errors });
  }
  const input = checked.value;
  const no = refuse(principal, op, input);
  if (no) throw no;
  // The row as it is now, so a role changed or a person disabled mid-session counts at once.
  const actor = getUser(root, principal.user.id);
  if (!actor || actor.disabled_at) throw new OpError('unauthenticated', 'This identity is disabled.', { status: 401 });
  const ctx = { root, actor, principal: { ...principal, user: actor }, input };
  const exec = async () => {
    let result;
    try {
      result = await op.run(ctx);
    } catch (e) {
      if (e instanceof OpError) throw e;
      const code = e?.status === 403 ? 'denied' : e?.code || 'failed';
      throw new OpError(code, e?.message || String(e), { status: e?.status || (code === 'failed' ? 422 : 400), cause: e });
    }
    result ??= { ok: true };
    const out = validate(op.output, result, '(result)');
    if (!out.ok) {
      throw new OpError('bad_output', `${name} produced a result outside its schema: ${out.errors.slice(0, 3).join('; ')}`, { status: 500, details: out.errors });
    }
    if (op.activity) {
      const a = op.activity(input, result, ctx);
      if (a) logActivity(root, { actor, verb: a.verb, subject: a.subject ?? null, detail: a.detail ?? null });
    }
    return result;
  };
  return op.kind === 'command' ? serial(exec) : exec();
}

/** An operation's public description: what MCP's tools/list and GET /api/ops return. */
export function describe(op) {
  return {
    name: op.name, kind: op.kind, summary: op.summary, stamp: op.stamp, untrusted: op.untrusted,
    permission: typeof op.permission === 'function' ? 'depends on input' : op.permission,
    input: op.input, output: op.output,
  };
}
