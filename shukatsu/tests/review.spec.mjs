import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLive, loadProfile } from '../core/facts.mjs';
import { decide, decided, queue, reopen } from '../core/review.mjs';
import { propose } from '../core/proposals.mjs';
import { readPipeline } from '../core/tracker.mjs';
import { gitLog, makeRoot, people, read } from './helpers.mjs';

test('the queue lists every draft shape, roles before their facts', () => {
  const root = makeRoot();
  const keys = queue(root).map((x) => x.key);
  assert.deepEqual(keys, [
    'draft:variant:acme.routing/eng',
    'draft:ja:acme.routing',
    'draft:fact:acme.dashboard',
    'draft:entity:cafe',
  ]);
});

test('accepting as written verifies in place, keeps evidence, re-renders cv.md, and commits', () => {
  const root = makeRoot();
  const { owner } = people(root);
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'accept' });
  const f = loadProfile(root)._facts.get('acme.dashboard').fact;
  assert.equal(f.review_status, 'verified');
  assert.equal(f.evidence.source, 'sources/notes.md');
  assert.match(read(root, 'cv.md'), /14 KPIs/);
  assert.match(gitLog(root), /\|Confirm acme\.dashboard\|/);
  // Only the one line changed: comments and alignment survive.
  assert.match(read(root, 'data/career-profile.yml'), /# Drafts below\. Numbers are verbatim/);
  assert.match(read(root, 'data/career-profile.yml'), /eng: {5}\{ name: "Engineer"/);
});

test('a corrected figure makes the candidate the source: review-log evidence, provenance U', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const text = 'Built a pipeline dashboard tracking 12 KPIs that the ops lead reviewed every Monday with 3 regional managers.';
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'accept', text });
  const f = loadProfile(root)._facts.get('acme.dashboard').fact;
  assert.equal(f.text, text);
  assert.equal(f.provenance, 'U');
  assert.equal(f.evidence.source, 'sources/review-log.md');
  const log = read(root, 'sources/review-log.md').split('\n');
  assert.ok(log[f.evidence.line - 1].includes(f.evidence.quote));
});

test('a rewording with the same figures keeps the original evidence', () => {
  const root = makeRoot();
  const { owner } = people(root);
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'accept', text: 'Created a dashboard of 14 KPIs that the ops lead walked through every Monday with 3 regional managers.' });
  const f = loadProfile(root)._facts.get('acme.dashboard').fact;
  assert.equal(f.provenance, 'M');
  assert.equal(f.evidence.source, 'sources/notes.md');
});

test('narrative-only must drop the figures in question', () => {
  const root = makeRoot();
  const { owner } = people(root);
  assert.throws(() => decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'narrative', text: 'Built a dashboard of 14 KPIs for the ops lead.' }), /drop the figures/);
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'narrative', text: 'Built the pipeline dashboard the ops lead reviewed every Monday with the regional managers.' });
  assert.equal(loadProfile(root)._facts.get('acme.dashboard').fact.review_status, 'verified');
});

test("I don't know is durable: out of the queue, never live, reopenable", () => {
  const root = makeRoot();
  const { owner } = people(root);
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'cannot-confirm' });
  const f = loadProfile(root)._facts.get('acme.dashboard').fact;
  assert.equal(f.status, 'cannot-confirm');
  assert.equal(isLive(f), false);
  assert.ok(!queue(root).some((x) => x.key === 'draft:fact:acme.dashboard'));
  assert.ok(decided(root).drafts.some((x) => x.key === 'draft:fact:acme.dashboard' && x.status === 'cannot-confirm'));
  reopen(root, { actor: owner, key: 'draft:fact:acme.dashboard' });
  const back = loadProfile(root)._facts.get('acme.dashboard').fact;
  assert.equal(back.status, undefined);
  assert.equal(back.review_status, 'needs_review');
});

test('rejecting needs a reason, works on flow-map Japanese text, and reopens cleanly', () => {
  const root = makeRoot();
  const { owner } = people(root);
  assert.throws(() => decide(root, { actor: owner, key: 'draft:ja:acme.routing', outcome: 'reject' }), /Say why/);
  decide(root, { actor: owner, key: 'draft:ja:acme.routing', outcome: 'reject', reason: 'Reads stiff, rewrite later' });
  const ja = loadProfile(root)._facts.get('acme.routing').fact.ja;
  assert.equal(ja.status, 'rejected');
  assert.equal(ja.decision_note, 'Reads stiff, rewrite later');
  reopen(root, { actor: owner, key: 'draft:ja:acme.routing' });
  const again = loadProfile(root)._facts.get('acme.routing').fact.ja;
  assert.equal(again.status, undefined);
  assert.equal(again.review_status, 'needs_review');
});

test('a variant can never change its fact\'s figures', () => {
  const root = makeRoot();
  const { owner } = people(root);
  assert.throws(() => decide(root, { actor: owner, key: 'draft:variant:acme.routing/eng', outcome: 'accept', text: 'Built lead-routing automation that cut triage from 40 to 4 minutes a day across 1,200 weekly leads for 6 people.' }), /same figures/);
  decide(root, { actor: owner, key: 'draft:variant:acme.routing/eng', outcome: 'accept' });
  assert.equal(loadProfile(root)._facts.get('acme.routing').fact.variants[0].review_status, 'verified');
});

test('only the owner decides', () => {
  const root = makeRoot();
  const { editor, reviewer } = people(root);
  for (const actor of [editor, reviewer]) {
    assert.throws(() => decide(root, { actor, key: 'draft:fact:acme.dashboard', outcome: 'accept' }), /permission/);
  }
});

test("an editor's reword lands as a proposal, applies on accept, and credits them in the commit", () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const id = propose(root, { actor: editor, kind: 'fact.edit', payload: { id: 'tool.speed', text: 'Built an open-source CLI used by 30 people that cut a 45 minute report build to 13 seconds through a two-layer cache.' }, note: 'Lead with the users' });
  const it = queue(root).find((x) => x.key === `proposal:${id}`);
  assert.equal(it.kind, 'proposal.fact.edit');
  assert.equal(it.author.name, 'Mom');
  assert.ok(!it.warnings.some((w) => w.code === 'numbers-changed'));
  decide(root, { actor: owner, key: `proposal:${id}`, outcome: 'accept' });
  assert.match(loadProfile(root)._facts.get('tool.speed').fact.text, /^Built an open-source CLI used by 30 people/);
  assert.match(gitLog(root), /Proposed-by: Mom/);
});

test('a stale proposal is flagged when the wording moved underneath it', () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const id = propose(root, { actor: editor, kind: 'fact.edit', payload: { id: 'acme.dashboard', text: 'Built a dashboard of 14 KPIs reviewed every Monday by the ops lead with 3 regional managers.' } });
  decide(root, { actor: owner, key: 'draft:fact:acme.dashboard', outcome: 'accept', text: 'Created a dashboard of 14 KPIs that the ops lead walked through every Monday with 3 regional managers.' });
  const it = queue(root).find((x) => x.key === `proposal:${id}`);
  assert.ok(it.warnings.some((w) => w.code === 'stale'));
});

test('a new fact proposed for a role with no facts is appended with review-log evidence', () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const weak = propose(root, { actor: editor, kind: 'fact.new', payload: { entity: 'cafe', text: 'Served about 120 customers a shift in English and Japanese during the tourist season.' } });
  assert.throws(() => decide(root, { actor: owner, key: `proposal:${weak}`, outcome: 'accept' }), /weak-opener/);
  const id = propose(root, { actor: editor, kind: 'fact.new', payload: { entity: 'cafe', text: 'Greeted about 120 customers a shift in English and Japanese during the tourist season.', tags: 'leadership' } });
  decide(root, { actor: owner, key: `proposal:${id}`, outcome: 'accept' });
  const p = loadProfile(root);
  const cafe = p._entities.find((e) => e.id === 'cafe');
  assert.equal(cafe.facts.length, 1);
  assert.equal(cafe.facts[0].evidence.source, 'sources/review-log.md');
  assert.match(read(root, 'sources/review-log.md'), /proposed by Mom/);
  assert.deepEqual(cafe.facts[0].tags, ['leadership']);
});

test('a suggested posting goes to the pipeline inbox once', () => {
  const root = makeRoot();
  const { owner, reviewer } = people(root);
  const id = propose(root, { actor: reviewer, kind: 'posting', payload: { url: 'https://jobs.example.com/123', company: 'Example', role: 'Analyst Intern', note: 'Saw this on LinkedIn' } });
  assert.throws(() => propose(root, { actor: reviewer, kind: 'posting', payload: { url: 'https://jobs.example.com/123' } }), /already suggested/);
  decide(root, { actor: owner, key: `proposal:${id}`, outcome: 'accept' });
  const items = readPipeline(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].company, 'Example');
  assert.match(items[0].note, /suggested by Mentor/);
  assert.equal(items[0].location, '');
});

test('reviewers cannot propose profile changes', () => {
  const root = makeRoot();
  const { reviewer } = people(root);
  assert.throws(() => propose(root, { actor: reviewer, kind: 'fact.edit', payload: { id: 'tool.speed', text: 'x'.repeat(30) } }), /permission/);
});
