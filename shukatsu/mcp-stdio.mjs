#!/usr/bin/env node
/**
 * shukatsu as a stdio MCP server, for clients that launch a command instead of
 * connecting to a URL.
 *
 * It is a relay and nothing else: every JSON-RPC message on stdin is POSTed to
 * the daemon's /mcp with an agent token, and every answer goes back out on
 * stdout. It never opens the data files, because a second process writing
 * them would be a second writer. Permissions, stamps, and logging all happen
 * in the daemon.
 *
 *   SHUKATSU_URL    the daemon (default http://127.0.0.1:3000)
 *   SHUKATSU_TOKEN  an agent token (required)
 */

import { createInterface } from 'node:readline';

const BASE = (process.env.SHUKATSU_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = process.env.SHUKATSU_TOKEN;

const log = (msg) => process.stderr.write(`shukatsu-mcp: ${msg}\n`);
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

if (!TOKEN) {
  log('SHUKATSU_TOKEN is not set. Make a token for this agent on the Agents page in shukatsu (Settings, Agents, New key), then set SHUKATSU_TOKEN to it.');
  process.exit(1);
}

let protocolVersion = null;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Pull the JSON-RPC messages out of a server-sent-events body. */
const fromEventStream = (text) => text.split(/\r?\n\r?\n/)
  .map((block) => block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n'))
  .filter(Boolean).map((d) => JSON.parse(d));

async function forward(message) {
  const id = message && typeof message === 'object' && !Array.isArray(message) ? message.id : undefined;
  try {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN}`,
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
      },
      body: JSON.stringify(message),
    });
    if (res.status === 202 || res.status === 204) return;
    const text = await res.text();
    if (res.status === 401) {
      log('The daemon refused the token. It may be revoked or expired. Make a new one on the Agents page.');
      if (id !== undefined) out(rpcError(id, -32001, 'shukatsu refused the token. Make a new one on the Agents page.'));
      return;
    }
    const type = res.headers.get('content-type') || '';
    let replies;
    try { replies = type.includes('text/event-stream') ? fromEventStream(text) : [JSON.parse(text)]; } catch { replies = null; }
    if (!replies) {
      if (id !== undefined) out(rpcError(id, -32603, `shukatsu answered ${res.status} with something that isn't JSON-RPC.`));
      return;
    }
    for (const reply of replies.flat()) {
      if (reply?.result?.protocolVersion) protocolVersion = reply.result.protocolVersion;
      out(reply);
    }
  } catch (e) {
    log(`Can't reach ${BASE}/mcp (${e.cause?.code || e.message}). Is the daemon running?`);
    if (id !== undefined) out(rpcError(id, -32603, `Can't reach shukatsu at ${BASE}. Is the daemon running?`));
  }
}

const pending = new Set();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch {
    out(rpcError(null, -32700, 'Parse error'));
    return;
  }
  const job = forward(message).finally(() => pending.delete(job));
  pending.add(job);
});
// Let in-flight calls finish before the process ends when the client closes stdin.
lines.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
