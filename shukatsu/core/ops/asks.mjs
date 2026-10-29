/**
 * Asks: the candidate asking one person to look at one item (core/asks.mjs).
 * Asking, answering, and closing are people's acts, done in the app: an
 * agent can read the asks but never ask a parent anything or answer for one.
 */

import * as asks from '../asks.mjs';
import { S } from './schema.mjs';

const ID = S.int(null, { minimum: 1 });
const SUBJECT = S.str('One written answer, packet:{id}#a{n} (n from 1), or one fact\'s Japanese, fact:{id}/ja.', { pattern: asks.SUBJECT.source, maxLength: 120 });

export default [
  {
    name: 'ask.list',
    kind: 'query',
    summary: 'Asks, newest first: every ask for the candidate, only the ones addressed to you for anyone else.',
    permission: 'view.review',
    input: S.obj({ status: S.enum(['open', 'answered', 'closed', 'cancelled'], 'Only asks in this state.') }),
    output: S.obj({ asks: S.arr(S.any()) }, ['asks']),
    run: ({ root, actor, input }) => ({ asks: asks.listAsks(root, actor, { status: input.status ?? null }) }),
  },
  {
    name: 'ask.get',
    kind: 'query',
    summary: 'One ask: what it is about as it was when asked, the note, the reply, and how it closed.',
    permission: 'view.review',
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => asks.getAsk(root, input.id, actor),
  },
  {
    name: 'ask.create',
    kind: 'command',
    summary: 'Ask one person to look at one written answer or one fact\'s Japanese. They get a nudge with a link.',
    permission: 'ask.create',
    agent: false,
    input: S.obj({ to: S.int('The person asked (a user id).', { minimum: 1 }), subject: SUBJECT, note: S.text('What you would like them to look at.', 1000) }, ['to', 'subject']),
    output: S.obj({ id: S.int() }, ['id']),
    run: ({ root, actor, input }) => ({ id: asks.createAsk(root, { actor, to: input.to, subject: input.subject, note: input.note }) }),
  },
  {
    name: 'ask.reply',
    kind: 'command',
    summary: 'Answer an ask made to you: new wording, or fine to say it reads right as it is.',
    permission: 'view.review',
    agent: false,
    input: S.obj({ id: ID, text: S.text(null, 10_000), note: S.text(null, 1000), fine: S.bool(null, { default: false }) }, ['id']),
    output: S.obj({ status: S.str(), outcome: S.str(), proposal: S.nullable(S.int()) }, ['status']),
    run: ({ root, actor, input }) => asks.replyAsk(root, { actor, id: input.id, text: input.text, note: input.note, fine: input.fine }),
  },
  {
    name: 'ask.close',
    kind: 'command',
    summary: 'Use an answer to a written-answer ask (it replaces that answer on the packet) or set it aside, with a note they will see.',
    permission: 'ask.create',
    agent: false,
    input: S.obj({ id: ID, outcome: S.enum(['used', 'not_used']), note: S.text(null, 1000) }, ['id', 'outcome']),
    output: S.any(),
    run: ({ root, actor, input }) => { asks.closeAsk(root, { actor, id: input.id, outcome: input.outcome, note: input.note }); return { ok: true }; },
  },
  {
    name: 'ask.cancel',
    kind: 'command',
    summary: 'Withdraw an ask that is still open or answered.',
    permission: 'ask.create',
    agent: false,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { asks.cancelAsk(root, { actor, id: input.id }); return { ok: true }; },
  },
];
