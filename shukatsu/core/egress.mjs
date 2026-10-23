/**
 * The egress log: one JSON line in {DATA_ROOT}/.shukatsu/egress.log for every
 * call shukatsu makes to an outside service. Three modules make those calls,
 * and each writes here: connectors/ctx.mjs (every connector request),
 * core/llm.mjs (the model), and core/oauth.mjs (an MCP client's metadata
 * document). DATAFLOW.md says what each one sends, where, and why.
 *
 * A line holds the time, who or what made the call and what for, the host or
 * model, the sizes, the status, and how long it took. It never holds a URL
 * path or query (a calendar feed's address is a credential), a header, a
 * token, or any text that was sent.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { stateDir } from './lock.mjs';

export function logEgress(root, entry) {
  try {
    mkdirSync(stateDir(root), { recursive: true });
    appendFileSync(join(stateDir(root), 'egress.log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // The log is the audit trail, so an unwritable one is worth saying out loud, but it must not fail the call.
    console.error('shukatsu: could not write egress.log');
  }
}
