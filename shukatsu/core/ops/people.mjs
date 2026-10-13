/**
 * People, agents, and tokens, plus the activity log and the digest.
 *
 * Who has access is a stamp: inviting, changing a role, cutting someone off,
 * creating an agent or a token. An agent can read the activity log and the
 * digest, and nothing else here.
 */

import * as people from '../people.mjs';
import { removePasskey } from '../passkeys.mjs';
import { db, recentActivity } from '../store.mjs';
import { digest, digestText } from '../digest.mjs';
import { S } from './schema.mjs';

const ID = S.int(null, { minimum: 1 });
const PERSON = people.PERSON_ROLES.filter((r) => r !== 'owner');

/** An app-only, signed-in-person operation: the account's own settings. */
const own = (op) => ({ agent: false, permission: 'view', ...op });

export default [
  // ---------------------------------------------------------------- people
  {
    name: 'people.list',
    kind: 'query',
    summary: 'Who can use this install, and the open invites.',
    permission: 'people.manage',
    agent: false,
    input: S.obj({}),
    output: S.any(),
    run: ({ root }) => ({ people: people.listUsers(root), invites: people.openInvites(root) }),
  },
  {
    name: 'people.invite',
    kind: 'command',
    summary: 'Invite a person (editor, reviewer, viewer). Returns a one-time link token.',
    permission: 'people.manage',
    stamp: true,
    input: S.obj({
      name: S.str(null, { minLength: 1, maxLength: 80 }), role: S.enum(PERSON), relation: S.str(null, { maxLength: 60 }),
      lang: S.enum(['en', 'ja'], null, { default: 'en' }), days: S.int(null, { minimum: 1, maximum: 30, default: 7 }),
    }, ['name', 'role']),
    output: S.obj({ token: S.str(), name: S.str() }, ['token']),
    run: ({ root, actor, input }) => ({ token: people.createInvite(root, { actor, ...input, relation: input.relation || null }), name: input.name }),
  },
  {
    name: 'people.reset',
    kind: 'command',
    summary: 'A fresh one-time sign-in link for someone locked out. It signs out their other sessions when used.',
    permission: 'people.manage',
    stamp: true,
    input: S.obj({ id: ID }, ['id']),
    output: S.obj({ token: S.str() }, ['token']),
    run: ({ root, actor, input }) => {
      const target = people.getUser(root, input.id);
      if (!target || target.kind !== 'person') throw new Error('No such person.');
      return { token: people.createInvite(root, { actor, role: target.role, name: target.name, userId: target.id, days: 2 }) };
    },
  },
  {
    name: 'people.update',
    kind: 'command',
    summary: 'Change a person\'s role or what they may see (compensation).',
    permission: 'people.manage',
    stamp: true,
    input: S.obj({ id: ID, role: S.enum(PERSON), can_see_comp: S.bool(), relation: S.str(null, { maxLength: 60 }), name: S.str(null, { maxLength: 80 }) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      const { id, ...changes } = input;
      return people.updateUser(root, { actor, id, changes });
    },
  },
  {
    name: 'people.disable',
    kind: 'command',
    summary: 'Cut a person off (disabled, signed out everywhere), or restore them with enable.',
    permission: 'people.manage',
    stamp: true,
    input: S.obj({ id: ID, enable: S.bool(null, { default: false }) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      if (input.enable) people.enableUser(root, { actor, id: input.id });
      else people.disableUser(root, { actor, id: input.id });
      return { ok: true };
    },
  },
  {
    name: 'invite.revoke',
    kind: 'command',
    summary: 'Revoke an unused invite link.',
    permission: 'people.manage',
    stamp: true,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { people.revokeInvite(root, { actor, id: input.id }); return { ok: true }; },
  },

  // ---------------------------------------------------------------- agents and tokens
  {
    name: 'agent.list',
    kind: 'query',
    summary: 'The agents on this install and their live tokens.',
    permission: 'agent.manage',
    agent: false,
    input: S.obj({}),
    output: S.any(),
    run: ({ root }) => ({ agents: people.listAgents(root), tokens: people.listTokens(root) }),
  },
  {
    name: 'agent.create',
    kind: 'command',
    summary: 'Name a new agent ("Claude Code on the laptop", "claude.ai"). It can do the candidate\'s work but never stamp, and the activity log shows its name.',
    permission: 'agent.manage',
    stamp: true,
    input: S.obj({ name: S.str(null, { minLength: 1, maxLength: 60 }), can_see_comp: S.bool(null, { default: false }), can_see_contacts: S.bool(null, { default: false }) }, ['name']),
    output: S.obj({ id: S.int(), login: S.str(), name: S.str() }, ['id']),
    run: ({ root, actor, input }) => {
      const a = people.createAgent(root, { actor, name: input.name, canSeeComp: input.can_see_comp, canSeeContacts: input.can_see_contacts });
      return { id: a.id, login: a.login, name: a.name };
    },
  },
  {
    name: 'agent.update',
    kind: 'command',
    summary: 'Rename an agent or change what it may see (compensation, contacts).',
    permission: 'agent.manage',
    stamp: true,
    input: S.obj({ id: ID, name: S.str(null, { minLength: 1, maxLength: 60 }), can_see_comp: S.bool(), can_see_contacts: S.bool() }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      const target = people.getUser(root, input.id);
      if (!target || target.kind !== 'agent') throw new Error('No such agent.');
      const { id, ...changes } = input;
      return people.updateUser(root, { actor, id, changes });
    },
  },
  {
    name: 'agent.disable',
    kind: 'command',
    summary: 'Cut an agent off: disabled, every token revoked. Its history stays under its name.',
    permission: 'agent.manage',
    stamp: true,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { people.disableAgent(root, { actor, id: input.id }); return { ok: true }; },
  },
  {
    name: 'token.list',
    kind: 'query',
    summary: 'Live tokens: agents\', the capture bookmarklet\'s, calendar feeds\', and remote clients\'.',
    permission: 'token.manage',
    agent: false,
    input: S.obj({ user_id: ID, kinds: S.arr(S.enum(people.TOKEN_KINDS)) }),
    output: S.obj({ tokens: S.arr(S.any()) }, ['tokens']),
    run: ({ root, input }) => ({ tokens: people.listTokens(root, { userId: input.user_id, kinds: input.kinds }) }),
  },
  {
    name: 'token.create',
    kind: 'command',
    summary: 'Make a token: an agent\'s key, the capture bookmarklet\'s, or a private calendar feed for a person. The value is shown once.',
    permission: 'token.manage',
    stamp: true,
    input: S.obj({
      user_id: ID,
      kind: S.enum(['agent', 'capture', 'feed', 'cli']),
      name: S.str('What it\'s for, e.g. "laptop", "Mom\'s calendar".', { minLength: 1, maxLength: 80 }),
      scopes: S.arr(S.str(), 'Operation names this token may call (agent tokens; default every operation the agent may call).'),
      days: S.int('Expire after this many days (default: never, until revoked).', { minimum: 1, maximum: 3650 }),
    }, ['user_id', 'kind', 'name']),
    output: S.obj({ id: S.int(), token: S.str(), expires_at: S.nullable(S.str()) }, ['id', 'token']),
    run: ({ root, actor, input }) => people.issueToken(root, { actor, userId: input.user_id, kind: input.kind, name: input.name, scopes: input.scopes, days: input.days }),
  },
  {
    name: 'token.revoke',
    kind: 'command',
    summary: 'Revoke a token. Whatever holds it stops working at once.',
    permission: 'token.manage',
    stamp: true,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { people.revokeToken(root, { actor, id: input.id }); return { ok: true }; },
  },

  // ---------------------------------------------------------------- your own account
  own({
    name: 'account.update',
    kind: 'command',
    summary: 'Your name, email, and language.',
    input: S.obj({ name: S.str(null, { maxLength: 80 }), email: S.nullable(S.str(null, { maxLength: 200 })), lang: S.enum(['en', 'ja']) }),
    output: S.any(),
    run: ({ root, actor, input }) => people.updateUser(root, { actor, id: actor.id, changes: input }),
  }),
  own({
    name: 'account.password',
    kind: 'command',
    summary: 'Change your password (needs the current one).',
    input: S.obj({ current: S.str(null, { maxLength: 200 }), password: S.str(null, { maxLength: 200 }) }, ['current', 'password']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      if (!people.verifyPassword(root, actor.id, input.current)) throw Object.assign(new Error('settings.wrongPassword'), { code: 'settings.wrongPassword' });
      if (input.password === input.current) throw Object.assign(new Error('password.same'), { code: 'password.same' });
      people.setPassword(root, { actor, id: actor.id, password: input.password });
      return { ok: true };
    },
  }),
  own({
    name: 'passkey.remove',
    kind: 'command',
    summary: 'Remove one of your passkeys.',
    input: S.obj({ id: S.str(null, { minLength: 1, maxLength: 400 }) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { removePasskey(root, { actor, id: input.id }); return { ok: true }; },
  }),
  own({
    name: 'session.end',
    kind: 'command',
    summary: 'Sign out one of your sessions.',
    input: S.obj({ hash: S.str(null, { pattern: '^[0-9a-f]{64}$' }) }, ['hash']),
    output: S.any(),
    run: ({ root, actor, input }) => { people.endSessionByHash(root, { actor, hash: input.hash }); return { ok: true }; },
  }),
  own({
    name: 'activity.seen',
    kind: 'command',
    summary: 'Mark the activity feed read up to now.',
    input: S.obj({}),
    output: S.any(),
    run: ({ root, actor }) => {
      const top = recentActivity(root, { limit: 1 })[0];
      if (top) db(root).prepare('UPDATE users SET seen_activity_id = ? WHERE id = ?').run(top.id, actor.id);
      return { ok: true };
    },
  }),

  // ---------------------------------------------------------------- what happened
  {
    name: 'activity.list',
    kind: 'query',
    summary: 'The activity log, newest first: who (person or agent) did what, to what.',
    permission: 'view',
    input: S.obj({ limit: S.int(null, { minimum: 1, maximum: 200, default: 50 }), before: S.int(null, { minimum: 1 }), subject: S.str(null, { maxLength: 200 }) }),
    output: S.obj({ activity: S.arr(S.any()) }, ['activity']),
    run: ({ root, input }) => ({ activity: recentActivity(root, input).map(({ actor_id: _a, ...a }) => a) }),
  },
  {
    name: 'digest.week',
    kind: 'query',
    summary: 'The weekly digest the family reads: what moved, what\'s next, what needs the candidate. As data, and as text in English or Japanese.',
    permission: 'view',
    input: S.obj({ days: S.int(null, { minimum: 1, maximum: 60, default: 7 }), lang: S.enum(['en', 'ja'], null, { default: 'en' }) }),
    output: S.obj({ digest: S.any(), text: S.str() }, ['digest', 'text']),
    run: ({ root, input }) => {
      const d = digest(root, { days: input.days });
      return { digest: d, text: digestText(d, input.lang) };
    },
  },
];
