/**
 * The review queue: drafts in the record, people's proposals, and packets
 * waiting for the candidate. Deciding is a stamp; everyone who may see the
 * queue may comment.
 */

import * as review from '../review.mjs';
import { withdraw, revise, proposalsBy } from '../proposals.mjs';
import { addComment, comments, resolveComment } from '../store.mjs';
import { S } from './schema.mjs';

const KEY = S.str('A review item key, e.g. proposal:12, draft:fact:acme.cache, packet:3.', { pattern: '^(proposal:\\d+|packet:\\d+|draft:(entity|fact|variant|ja):[a-z0-9.\\-]+(/[a-z0-9\\-]+)?)$' });
const SUBJECT = S.str('What the comment is about: a review key, fact:{id}, packet:{id}, app:{num}, campaign:{id}.', { pattern: '^[a-z]+:[\\w.\\-/:#]+$', maxLength: 200 });

/** A queue item without the bulk an agent never needs (the full entity under every fact). */
const slim = (it) => ({
  key: it.key, kind: it.kind, source: it.source, author: it.author ? { name: it.author.name, role: it.author.role } : null,
  created_at: it.created_at, before: it.before ?? null, after: it.after ?? null, has_numbers: Boolean(it.hasNumbers),
  checks: it.checks || [], warnings: it.warnings || [], comments: it.comments || 0, stale: Boolean(it.stale),
  entity: it.entity ? { id: it.entity.id, heading: it.entity.heading } : null,
});

export default [
  {
    name: 'review.list',
    kind: 'query',
    summary: 'Everything waiting for the candidate: record drafts, proposals from people and agents, and packets in review. Agents can read and comment; only the candidate decides.',
    permission: 'view.review',
    input: S.obj({
      source: S.enum(['all', 'people', 'profile'], 'people = proposals and packets; profile = drafts in the record.', { default: 'all' }),
      decided: S.bool('Instead, what has been decided already: rejected and can\'t-confirm drafts, and closed proposals.', { default: false }),
    }),
    output: S.obj({ total: S.int(), items: S.arr(S.any()), decided: S.any() }, ['total', 'items']),
    run: ({ root, input }) => {
      if (input.decided) {
        const d = review.decided(root);
        return { total: d.drafts.length + d.proposals.length, items: [], decided: d };
      }
      const items = review.queue(root).filter((x) => input.source === 'all' || (input.source === 'profile' ? x.source === 'profile' : x.source !== 'profile'));
      return { total: items.length, items: items.map(slim) };
    },
  },
  {
    name: 'review.get',
    kind: 'query',
    summary: 'One review item in full, with its checks and the comments on it.',
    permission: 'view.review',
    input: S.obj({ key: KEY }, ['key']),
    output: S.obj({ item: S.any(), comments: S.arr(S.any()) }, ['item', 'comments']),
    run: ({ root, input }) => {
      const it = review.item(root, input.key);
      if (!it) throw Object.assign(new Error('That item isn\'t waiting for review (it may be decided already).'), { code: 'not_found', status: 404 });
      return { item: it, comments: comments(root, input.key).map((c) => ({ id: c.id, author: c.author_name, role: c.author_role, body: c.body, created_at: c.created_at, resolved: Boolean(c.resolved_at) })) };
    },
  },
  {
    name: 'review.decide',
    kind: 'command',
    summary: 'Decide a review item: accept (optionally with edited wording), keep as narrative only, mark "I don\'t know", or reject with a reason. A stamp.',
    permission: 'review.decide',
    stamp: true,
    agent: false,
    input: S.obj({
      key: KEY,
      outcome: S.enum(['accept', 'narrative', 'cannot-confirm', 'reject']),
      text: S.text('Edited wording, for accept or narrative.', 2000),
      reason: S.text('Why, for reject and cannot-confirm. The proposer sees it.', 300, { default: '' }),
    }, ['key', 'outcome']),
    output: S.any(),
    run: ({ root, actor, input }) => review.decide(root, { actor, key: input.key, outcome: input.outcome, text: input.text ?? null, reason: input.reason }),
  },
  {
    name: 'review.reopen',
    kind: 'command',
    summary: 'Put a rejected or can\'t-confirm record draft back in the queue. A stamp.',
    permission: 'review.decide',
    stamp: true,
    agent: false,
    input: S.obj({ key: KEY }, ['key']),
    output: S.any(),
    run: ({ root, actor, input }) => review.reopen(root, { actor, key: input.key }),
  },
  {
    name: 'proposal.mine',
    kind: 'query',
    summary: 'Proposals this identity made, open and decided, with the candidate\'s reasons.',
    permission: 'view',
    input: S.obj({}),
    output: S.obj({ proposals: S.arr(S.any()) }, ['proposals']),
    run: ({ root, actor }) => ({ proposals: proposalsBy(root, actor.id) }),
  },
  {
    name: 'proposal.update',
    kind: 'command',
    summary: 'Revise the wording or note of a proposal you made that is still open, or withdraw it.',
    permission: 'view',
    input: S.obj({ id: S.int(null, { minimum: 1 }), withdraw: S.bool(null, { default: false }), payload: { type: 'object' }, note: S.text(null, 1000) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      if (input.withdraw) withdraw(root, { actor, id: input.id });
      else revise(root, { actor, id: input.id, payload: input.payload || {}, note: input.note });
      return { ok: true };
    },
  },
  {
    name: 'comment.add',
    kind: 'command',
    summary: 'Comment on a review item, fact, packet, application, or campaign. The candidate and helpers see it.',
    permission: 'comment',
    input: S.obj({ subject: SUBJECT, body: S.text(null, 4000, { minLength: 1 }) }, ['subject', 'body']),
    output: S.obj({ id: S.int() }, ['id']),
    run: ({ root, actor, input }) => ({ id: addComment(root, { actor, subject: input.subject, body: input.body }) }),
  },
  {
    name: 'comment.resolve',
    kind: 'command',
    summary: 'Mark a comment resolved.',
    permission: 'comment',
    agent: false,
    input: S.obj({ id: S.int(null, { minimum: 1 }) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => { resolveComment(root, { actor, id: input.id }); return { ok: true }; },
  },
];
