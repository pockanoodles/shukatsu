/**
 * The master record: what the candidate has done, one fact at a time.
 * Reads are open to anyone who may see the profile; changes are proposals,
 * which only the candidate's stamp turns into the record.
 */

import { BULLET_SECTIONS, isLive, isPending, loadProfile, similarity, statusOf, isVerified, ENTITY_KEYS, LIST_KEYS } from '../facts.mjs';
import { KINDS, propose } from '../proposals.mjs';
import { trace } from '../trace.mjs';
import { can } from '../people.mjs';
import { S } from './schema.mjs';

const factView = (f, { evidence }) => ({
  id: f.id, text: f.text, tags: f.tags || [], provenance: f.provenance || null, status: statusOf(f),
  verified: isVerified(f), live: isLive(f), priority: f.priority ?? null,
  ja: f.ja?.text ? { text: f.ja.text, verified: isVerified(f.ja) } : null,
  variants: (f.variants || []).map((v) => ({ key: v.key, text: v.text, verified: isVerified(v) })),
  ...(evidence && f.evidence ? { evidence: f.evidence } : {}),
});

const entityView = (e, opts) => ({
  id: e.id, kind: e._key, section: e.section || null, heading: e.heading || e.name || e.title || e.id, title: e.title || null,
  organization: e.organization || e.company || e.institution || null, dates: e.dates || null, ended: e.ended ?? null,
  status: statusOf(e), verified: isVerified(e),
  facts: (e.facts || []).filter((f) => opts.pending || !isPending(f)).filter((f) => opts.retired || statusOf(f) === 'active').map((f) => factView(f, opts)),
});

const FACT = S.obj({
  id: S.str(), text: S.str(), tags: S.arr(S.str()), provenance: S.nullable(S.str()), status: S.str(), verified: S.bool(), live: S.bool(),
  priority: S.any(), ja: S.any(), variants: S.arr(S.any()), evidence: S.any(),
});

export default [
  {
    name: 'record.get',
    kind: 'query',
    summary: 'The master record: every experience, project, and education entry with its facts. Only "live" facts (active and verified) may appear on a resume.',
    permission: 'view.profile',
    input: S.obj({
      kind: S.enum(ENTITY_KEYS, 'Only this kind of entry.'),
      include_pending: S.bool('Also include facts still waiting for the candidate to confirm.', { default: false }),
      include_retired: S.bool('Also include retired, rejected, and can\'t-confirm facts.', { default: false }),
    }),
    output: S.obj({ archetypes: S.any(), tags: S.arr(S.str()), entries: S.arr(S.any()), lists: S.any() }, ['entries']),
    run: ({ root, actor, input }) => {
      const p = loadProfile(root);
      const opts = { pending: input.include_pending, retired: input.include_retired, evidence: can(actor, 'view.evidence-path') };
      return {
        archetypes: p.archetypes || null,
        tags: p.tag_vocabulary || [],
        entries: p._entities.filter((e) => !input.kind || e._key === input.kind).filter((e) => opts.retired || statusOf(e) === 'active').map((e) => entityView(e, opts)),
        lists: Object.fromEntries(LIST_KEYS.map((k) => [k, (p[k] || []).filter((f) => opts.pending || !isPending(f)).map((f) => factView(f, opts))])),
      };
    },
  },
  {
    name: 'record.search',
    kind: 'query',
    summary: 'Find facts by meaning-ish word overlap and tags, e.g. "dashboards" or "Japanese customers". Use before claiming anything about the candidate.',
    permission: 'view.profile',
    input: S.obj({
      q: S.str('What to look for.', { minLength: 1, maxLength: 500 }),
      tags: S.arr(S.str(), 'Only facts carrying all of these tags.'),
      live_only: S.bool('Only facts that may appear on a resume.', { default: true }),
      limit: S.int(null, { minimum: 1, maximum: 50, default: 12 }),
    }, ['q']),
    output: S.obj({ results: S.arr(S.obj({ score: S.num(), entry: S.nullable(S.str()), heading: S.nullable(S.str()), fact: FACT })) }, ['results']),
    run: ({ root, actor, input }) => {
      const p = loadProfile(root);
      const opts = { evidence: can(actor, 'view.evidence-path') };
      const results = [];
      for (const { fact, entity } of p._facts.values()) {
        if (input.live_only ? !isLive(fact) || (entity && !isLive(entity)) : statusOf(fact) !== 'active') continue;
        if (input.tags?.length && !input.tags.every((t) => (fact.tags || []).includes(t))) continue;
        const text = [fact.text, fact.ja?.text, ...(fact.variants || []).map((v) => v.text)].filter(Boolean).join(' ');
        const score = similarity(input.q, text) + (text.toLowerCase().includes(input.q.toLowerCase()) ? 0.5 : 0);
        if (score > 0.05) results.push({ score: Math.round(score * 100) / 100, entry: entity?.id ?? null, heading: entity?.heading ?? entity?.name ?? null, fact: factView(fact, opts) });
      }
      return { results: results.sort((a, b) => b.score - a.score).slice(0, input.limit) };
    },
  },
  {
    name: 'record.trace',
    kind: 'query',
    summary: 'Check a piece of writing (resume lines, a cover letter, an answer) against the record: which fact each line rests on, and which lines rest on nothing.',
    permission: 'view.profile',
    input: S.obj({
      text: S.text('The writing to check.', 50000, { minLength: 1 }),
      bullets: S.bool('Treat each line as a resume bullet.', { default: false }),
    }, ['text']),
    output: S.any(),
    run: ({ root, input }) => trace(loadProfile(root), input.text, '', { bullets: input.bullets }),
  },
  {
    name: 'profile.propose',
    kind: 'command',
    summary: 'Propose a change to the record: reword a fact, add one, retire one, or add an entry. It waits in the review queue until the candidate decides; nothing changes until then.',
    permission: 'propose.profile',
    input: S.obj({
      kind: S.enum(KINDS.filter((k) => k !== 'posting'), 'fact.edit rewords (id, part, text); fact.new adds (entity, text, tags); fact.retire retires (id, reason); entity.new adds an entry (section, heading, title, dates).'),
      payload: { type: 'object', description: 'The change. Fields depend on kind; see kind.' },
      note: S.text('Why, for the candidate.', 1000, { default: '' }),
    }, ['kind', 'payload']),
    output: S.obj({ proposal: S.int(), review_key: S.str() }, ['proposal', 'review_key']),
    run: ({ root, actor, input }) => {
      const id = propose(root, { actor, kind: input.kind, payload: input.payload, note: input.note });
      return { proposal: id, review_key: `proposal:${id}` };
    },
  },
];

export { BULLET_SECTIONS };
