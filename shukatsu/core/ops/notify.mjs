/**
 * The digest outside the app: each person linking their own LINE account,
 * and the owner seeing who is linked and sending the digest now.
 *
 * All of it is people-only and app-only. Linking is a stamp on your own
 * session (an agent has no phone, and a token must never be able to point
 * someone's digest at another chat account). Sending is the owner's, because
 * it decides what leaves the machine. The code that completes a link arrives
 * through LINE's webhook (connectors/line), not through here.
 */

import { addFriendUrl, sendDigest } from '../../connectors/line/index.mjs';
import { createCode, linkOf, links, unlink } from '../notify.mjs';
import { assertCan } from '../people.mjs';
import { listAccounts } from '../sync.mjs';
import { S } from './schema.mjs';

const SCHEDULE = S.obj({ weekday: S.int(), hour: S.int(), timezone: S.str() }, ['weekday', 'hour', 'timezone']);

function lineState(root) {
  const a = listAccounts(root, { connector: 'line' })[0];
  return {
    connected: Boolean(a),
    paused: a?.status === 'paused',
    add_friend_url: addFriendUrl(root),
    mode: a?.settings?.mode || null,
    schedule: a ? { weekday: a.settings.weekday ?? 0, hour: a.settings.hour ?? 9, timezone: a.settings.timezone || 'Asia/Tokyo' } : null,
  };
}

const notConnected = Object.assign(new Error('LINE isn\'t set up for this install yet. The owner connects it under Settings, Connections.'), { code: 'not_connected', status: 409 });

export default [
  {
    name: 'notify.status',
    kind: 'query',
    summary: 'Whether LINE is set up, how the digest goes out on it, and whether you have linked your own LINE account.',
    permission: 'notify.self',
    agent: false,
    input: S.obj({}),
    output: S.obj({
      line: S.obj({
        connected: S.bool(), paused: S.bool(), add_friend_url: S.nullable(S.str()), mode: S.nullable(S.enum(['nudge', 'full'])),
        schedule: S.nullable(SCHEDULE), linked: S.bool(), linked_at: S.nullable(S.str()),
      }, ['connected', 'linked']),
    }, ['line']),
    run: ({ root, actor }) => {
      const link = linkOf(root, actor.id, 'line');
      return { line: { ...lineState(root), linked: Boolean(link), linked_at: link?.linked_at || null } };
    },
  },
  {
    name: 'notify.linkCode',
    kind: 'command',
    summary: 'A six-digit code that links your own LINE account: send it to the install\'s LINE account within 15 minutes. Asking again replaces the last code.',
    permission: 'notify.self',
    stamp: true,
    agent: false,
    input: S.obj({}),
    output: S.obj({ code: S.str(), expires_at: S.str(), add_friend_url: S.nullable(S.str()) }, ['code', 'expires_at']),
    activity: (_input, _out, { actor }) => ({ verb: 'notify.code', subject: `person:${actor.id}`, detail: { channel: 'line' } }),
    run: ({ root, actor }) => {
      const state = lineState(root);
      if (!state.connected || state.paused) throw notConnected;
      return { ...createCode(root, { actor, channel: 'line' }), add_friend_url: state.add_friend_url };
    },
  },
  {
    name: 'notify.unlink',
    kind: 'command',
    summary: 'Stop the digest reaching a LINE account: your own, or (for the owner) anyone\'s.',
    permission: 'notify.self',
    stamp: true,
    agent: false,
    input: S.obj({ user_id: S.int('Whose link. Leave out for your own.', { minimum: 1 }) }),
    output: S.obj({ unlinked: S.bool() }, ['unlinked']),
    run: ({ root, actor, input }) => {
      const userId = input.user_id ?? actor.id;
      if (userId !== actor.id) assertCan(actor, 'people.manage');
      return { unlinked: unlink(root, { actor, userId, channel: 'line' }) };
    },
  },
  {
    name: 'notify.recipients',
    kind: 'query',
    summary: 'Who has linked a LINE account for the digest, and whether each still has access. Never returns a LINE id.',
    permission: 'people.manage',
    agent: false,
    input: S.obj({}),
    output: S.obj({
      line: S.obj({ connected: S.bool(), paused: S.bool(), add_friend_url: S.nullable(S.str()), mode: S.nullable(S.enum(['nudge', 'full'])), schedule: S.nullable(SCHEDULE) }, ['connected']),
      people: S.arr(S.obj({ user_id: S.int(), name: S.str(), role: S.str(), lang: S.str(), linked_at: S.str(), active: S.bool() })),
    }, ['line', 'people']),
    run: ({ root }) => ({ line: lineState(root), people: links(root, 'line') }),
  },
  {
    name: 'notify.send',
    kind: 'command',
    summary: 'Send this week\'s digest on LINE now, to one person or everyone linked, in the form the LINE connection is set to (nudge or full).',
    permission: 'connector.manage',
    stamp: true,
    agent: false,
    input: S.obj({ user_id: S.int('Only this person. Leave out for everyone linked.', { minimum: 1 }) }),
    output: S.obj({ mode: S.enum(['nudge', 'full']), sent: S.int(), failed: S.int(), error: S.nullable(S.str()) }, ['mode', 'sent', 'failed']),
    activity: (input, out) => ({ verb: 'notify.sent', subject: 'channel:line', detail: { mode: out.mode, sent: out.sent, failed: out.failed, ...(input.user_id ? { to: input.user_id } : {}) } }),
    run: ({ root, input }) => sendDigest(root, { userId: input.user_id ?? null }),
  },
];
