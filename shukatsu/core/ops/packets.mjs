/**
 * Application packets: a resume selected from the record, a cover letter,
 * and written answers, checked by the same gates finalize runs. Preparing a
 * packet is open to editors and agents; marking it ready or sent is a stamp.
 */

import * as packets from '../packets.mjs';
import { setCandidateJa } from '../candidate.mjs';
import { loadProfile } from '../facts.mjs';
import { suggestRewordings } from '../llm.mjs';
import { S } from './schema.mjs';

const ID = S.int('The packet id.', { minimum: 1 });
const ANSWER = S.obj({
  id: S.str('The answer\'s id from packet.get, so it stays the same answer. Leave out for a new one.', { pattern: '^a[0-9a-f]{8}$' }),
  question: S.str(null, { maxLength: 500, default: '' }),
  limit: S.nullable(S.int(null, { minimum: 0, maximum: 10000 })),
  unit: S.enum(['chars', 'words'], null, { default: 'chars' }),
  text: S.text(null, 10000, { default: '' }),
});

const listRow = (pk) => ({
  id: pk.id, company: pk.company, role: pk.role, url: pk.url, archetype: pk.archetype, lang: pk.lang, status: pk.status,
  tracker_num: pk.tracker_num, author: pk.author_name, created_at: pk.created_at, updated_at: pk.updated_at, sent_on: pk.sent_on,
});

export default [
  {
    name: 'packet.list',
    kind: 'query',
    summary: 'Every application packet with its status (drafting, in_review, changes_requested, ready, sent, closed).',
    permission: 'view',
    input: S.obj({ status: S.enum(['drafting', 'in_review', 'changes_requested', 'ready', 'sent', 'closed']) }),
    output: S.obj({ packets: S.arr(S.any()) }, ['packets']),
    run: ({ root, input }) => ({ packets: packets.listPackets(root).filter((p) => !input.status || p.status === input.status).map(listRow) }),
  },
  {
    name: 'packet.get',
    kind: 'query',
    summary: 'One packet in full: the selected facts by section, the pool of other candidates, the check results, the cover letter, and the answers. jdText is outside text.',
    permission: 'view',
    untrusted: true,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      const pk = packets.getPacket(root, input.id, actor);
      if (!pk) throw Object.assign(new Error('No such packet.'), { code: 'not_found', status: 404 });
      const { jdText, ...rest } = pk;
      return { ...rest, untrusted: { jd: jdText || null } };
    },
  },
  {
    name: 'packet.create',
    kind: 'command',
    summary: 'Start a packet for a posting: archives the job description and selects facts for the archetype within the one-page budget.',
    permission: 'packet.create',
    input: S.obj({
      company: S.str(null, { minLength: 1, maxLength: 80 }),
      role: S.str(null, { minLength: 1, maxLength: 160 }),
      url: S.str(null, { maxLength: 2000, default: '' }),
      jd_text: S.text('The job description, verbatim.', 200000, { default: '' }),
      archetype: S.str('An archetype key from the record.', { minLength: 1 }),
      lang: S.enum(['en', 'ja'], null, { default: 'en' }),
    }, ['company', 'role', 'archetype']),
    output: S.obj({ id: S.int() }, ['id']),
    run: ({ root, actor, input }) => ({
      id: packets.createPacket(root, { actor, company: input.company, role: input.role, url: input.url, jdText: input.jd_text, archetype: input.archetype, lang: input.lang }),
    }),
  },
  {
    name: 'packet.select',
    kind: 'command',
    summary: 'Add, remove, or move a fact in a packet\'s selection.',
    permission: 'packet.edit',
    input: S.obj({ id: ID, fact: S.str(null, { minLength: 1 }), action: S.enum(['add', 'drop', 'up', 'down']) }, ['id', 'fact', 'action']),
    output: S.any(),
    run: ({ root, actor, input }) => packets.changeSelection(root, { actor, id: input.id, factId: input.fact, action: input.action }) ?? { ok: true },
  },
  {
    name: 'packet.edit',
    kind: 'command',
    summary: 'Edit a packet: reword selected facts (the figures must stay the fact\'s), set the cover letter or notes, and set the written answers on the form (ES, 志望動機, "Why us?"), counted the way forms count. Pass only what changes.',
    permission: 'packet.edit',
    input: S.obj({
      id: ID,
      bullets: S.arr(S.obj({ fact: S.str(null, { minLength: 1 }), text: S.text(null, 600, { minLength: 1 }) }, ['fact', 'text']), null, { maxItems: 30 }),
      cover: S.text('The cover letter.', 20000),
      notes: S.text('Notes for whoever reviews it.', 4000),
      answers: S.arr(ANSWER, 'Replaces every answer.', { maxItems: 20 }),
    }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => {
      for (const b of input.bullets || []) packets.setBullet(root, { actor, id: input.id, factId: b.fact, text: b.text });
      if (input.cover !== undefined || input.notes !== undefined) packets.setCover(root, { actor, id: input.id, text: input.cover, notes: input.notes });
      const answers = input.answers ? packets.setAnswers(root, { actor, id: input.id, answers: input.answers }) : undefined;
      return { ok: true, ...(answers ? { answers } : {}) };
    },
  },
  {
    name: 'packet.check',
    kind: 'command',
    summary: 'Run the packet\'s gates: every bullet traced to a live fact with the same figures, the bullet rules, the materials gate, and the Japanese style gate for a Japanese packet.',
    permission: 'packet.edit',
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => packets.checkPacket(root, { actor, id: input.id }),
  },
  {
    name: 'packet.requestReview',
    kind: 'command',
    summary: 'Send a packet to the candidate for review, or withdraw it from review to keep editing.',
    permission: 'packet.edit',
    input: S.obj({ id: ID, withdraw: S.bool(null, { default: false }) }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => (input.withdraw ? packets.withdrawReview(root, { actor, id: input.id }) : packets.requestReview(root, { actor, id: input.id })) ?? { ok: true },
  },
  {
    name: 'packet.ready',
    kind: 'command',
    summary: 'Approve a packet as ready to send. A stamp.',
    permission: 'review.decide',
    stamp: true,
    agent: false,
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => packets.markReady(root, { actor, id: input.id }) ?? { ok: true },
  },
  {
    name: 'packet.markSent',
    kind: 'command',
    summary: 'Record that the candidate submitted the application (outside shukatsu): the tracker row moves to Applied. A stamp.',
    permission: 'packet.send',
    stamp: true,
    agent: false,
    input: S.obj({ id: ID, on: S.date('The day it was sent.') }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => packets.markSent(root, { actor, id: input.id, on: input.on }),
  },
  {
    name: 'packet.close',
    kind: 'command',
    summary: 'Close a packet that won\'t be sent.',
    permission: 'packet.edit',
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, actor, input }) => packets.closePacket(root, { actor, id: input.id }) ?? { ok: true },
  },
  {
    name: 'packet.suggest',
    kind: 'query',
    summary: 'AI rewordings of one selected fact for this posting (the app\'s "Suggest" button; logged to egress.log).',
    permission: 'packet.edit',
    agent: false,
    input: S.obj({ id: ID, fact: S.str(null, { minLength: 1 }) }, ['id', 'fact']),
    output: S.any(),
    run: async ({ root, actor, input }) => {
      const pk = packets.getPacket(root, input.id, actor);
      if (!pk) throw Object.assign(new Error('No such packet.'), { code: 'not_found', status: 404 });
      const hit = loadProfile(root)._facts.get(input.fact);
      if (!hit) throw new Error('No such fact.');
      return suggestRewordings(root, { actor, fact: hit.fact, entity: hit.entity, jdText: pk.jdText, current: hit.entity?.ended === false });
    },
  },
  {
    name: 'candidate.setJa',
    kind: 'command',
    summary: 'The candidate\'s Japanese header for 職務経歴書: name, location, availability. A stamp (it is the candidate\'s own claim).',
    permission: 'profile.write',
    stamp: true,
    agent: false,
    input: S.obj({ name: S.str(null, { maxLength: 80, default: '' }), location: S.str(null, { maxLength: 120, default: '' }), availability: S.str(null, { maxLength: 200, default: '' }) }),
    output: S.any(),
    run: ({ root, actor, input }) => setCandidateJa(root, { actor, values: input }) ?? { ok: true },
  },
];
