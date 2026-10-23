/**
 * The context a connector runs with: the guarded fetch from
 * plugins/_engine.mjs, pinned to the connector's declared hosts, plus the one
 * audit line each request leaves in {DATA_ROOT}/.shukatsu/egress.log
 * (core/egress.mjs).
 *
 * A line holds the time, the connector and account, what the call was for,
 * the host, the method, how many characters were sent, the status, and how
 * long it took. It never holds a URL path or query (a calendar feed's address
 * is a credential), a header, a token, or any message text.
 *
 * `base` replaces the network in tests, and still goes through the host pin
 * and the audit line, so what a recorded run sends is checked the same way.
 */

import { buildCtx } from '../../plugins/_engine.mjs';
import { logEgress } from '../core/egress.mjs';

/** The hosts a connector may reach for this account: its manifest's, plus the account's own feed host when the manifest says so. */
export function hostsFor(manifest, account) {
  const hosts = [...(manifest.allowedHosts || [])];
  if (manifest.hostFromSettings && account?.settings?.[manifest.hostFromSettings]) hosts.push(account.settings[manifest.hostFromSettings]);
  return hosts;
}

export function makeConnectorCtx(root, manifest, account, { fetch: base = null, extra = {} } = {}) {
  const hosts = hostsFor(manifest, account);
  const built = buildCtx({ requiredEnv: [], optionalEnv: [], allowedHosts: hosts });
  const send = base || built.fetch;
  const who = { connector: manifest.id, account: account?.id ?? null };
  const fetch = async (url, opts = {}) => {
    const { purpose = 'request', ...rest } = opts;
    const u = new URL(url);
    const started = Date.now();
    const line = { actor: 'connector', ...who, purpose, host: u.hostname, method: rest.method || 'GET', sent_chars: String(rest.body || '').length };
    try {
      // The pin holds for an injected fetch too, so a recorded run proves where a real one would have gone.
      if (u.protocol !== 'https:') throw new Error(`egress must use HTTPS: ${u.hostname}`);
      if (!hosts.includes(u.hostname)) throw new Error(`egress to "${u.hostname}" is not in allowedHosts [${hosts.join(', ')}]`);
      const res = await send(url, { timeoutMs: 30_000, ...rest });
      logEgress(root, { ...line, status: res.status ?? 200, received_chars: Number(res.headers?.get?.('content-length')) || null, ms: Date.now() - started });
      return res;
    } catch (err) {
      logEgress(root, { ...line, status: err?.status ?? 'error', received_chars: null, ms: Date.now() - started });
      throw err;
    }
  };
  return {
    ...built,
    fetch,
    fetchText: async (u, o) => (await fetch(u, o)).text(),
    fetchJson: async (u, o) => (await fetch(u, o)).json(),
    root,
    ...extra,
  };
}
