/**
 * How a CLI runs an operation: through the daemon when it's up, so there is
 * one writer, and in this process when it isn't, as the owner at their own
 * terminal. Either way the call goes through the operations registry and its
 * checks, and the activity log says the candidate did it.
 *
 * The daemon is found at SHUKATSU_URL (default http://127.0.0.1:3000) and
 * reached with the owner's terminal token in .shukatsu/owner.token, which the
 * daemon writes (0600) once the owner exists.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stateDir } from './lock.mjs';
import { owner } from './people.mjs';
import { OpError, cliPrincipal, run } from './ops/index.mjs';

const base = () => (process.env.SHUKATSU_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

function ownerToken(root) {
  const file = join(stateDir(root), 'owner.token');
  return existsSync(file) ? readFileSync(file, 'utf-8').trim() : null;
}

async function viaDaemon(root, name, input) {
  const token = ownerToken(root);
  if (!token) return { reached: false };
  let res;
  try {
    res = await fetch(`${base()}/api/v1/ops/${name}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { reached: false };
  }
  const body = await res.json().catch(() => null);
  // A daemon serving another data root rejects this root's token: that isn't "our" daemon.
  if (res.status === 401 || !body) return { reached: false };
  if (!body.ok) throw new OpError(body.error.code, body.error.message, { status: res.status, details: body.error.details });
  return { reached: true, result: body.result };
}

/** Run `name` as the owner. Resolves to the result; rejects with an OpError. */
export async function callOp(root, name, input = {}) {
  const remote = await viaDaemon(root, name, input);
  if (remote.reached) return remote.result;
  const me = owner(root);
  if (!me) throw new OpError('unauthenticated', 'No owner yet. Run: node shukatsu/people.mjs init --name "Your Name"', { status: 401 });
  return run(root, cliPrincipal(me), name, input);
}
