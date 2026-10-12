import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadProfile } from '../core/facts.mjs';
import {
  changeSelection, checkPacket, coverCheck, createPacket, getPacket, markReady, setBullet, submitForReview,
} from '../core/packets.mjs';
import { decide, queue } from '../core/review.mjs';
import { readTracker } from '../core/tracker.mjs';
import { markSent, setAnswers } from '../core/packets.mjs';
import { readManifest } from '../core/manifests.mjs';
import { digest, digestText } from '../core/digest.mjs';
import { makeRoot, people, read } from './helpers.mjs';

const JD = 'We need an operations intern to own lead routing and KPI dashboards for our sales team.';

test('a packet archives the JD and writes a fact-tagged draft from the selection', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const id = createPacket(root, { actor: owner, company: 'Example Co', role: 'Ops Intern', url: 'https://example.com/jobs/1', jdText: JD, archetype: 'analyst' });
  const pk = getPacket(root, id, owner);
  assert.match(read(root, pk.jd_path), /## Job Description \(archived verbatim\)\n\nWe need an operations intern/);
  assert.ok(pk.sections.some((s) => s.entity.id === 'acme'));
  const draft = read(root, readManifest(root, pk.manifest.name).output);
  assert.match(draft, /<!-- fact:acme\.routing -->/);
  assert.match(readManifest(root, pk.manifest.name).output, /-cv\.md$/);
});

test('a JD rewording that keeps the figures passes the check; changing a figure fails it', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const id = createPacket(root, { actor: owner, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst' });
  setBullet(root, { actor: owner, id, factId: 'acme.routing', text: 'Rebuilt lead routing for the 6-person sales team, cutting manual triage from 40 to 5 minutes a day across 1,200 weekly leads.' });
  const ok = checkPacket(root, { actor: owner, id });
  assert.equal(ok.ok, true, ok.problems.join('\n') + ok.gates.filter((g) => !g.ok).map((g) => g.out).join('\n'));
  assert.ok(existsSync(join(root, ok.deliverable)));
  assert.doesNotMatch(read(root, ok.deliverable), /<!-- fact:/);
  setBullet(root, { actor: owner, id, factId: 'acme.routing', text: 'Rebuilt lead routing for the 6-person sales team, cutting manual triage from 40 to 3 minutes a day across 1,200 weekly leads.' });
  const bad = checkPacket(root, { actor: owner, id });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((x) => /numbers changed/.test(x)));
});

test('selection changes respect live facts and keep rewordings', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const id = createPacket(root, { actor: owner, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst' });
  assert.throws(() => changeSelection(root, { actor: owner, id, factId: 'acme.dashboard', action: 'add' }), /confirmed facts/);
  setBullet(root, { actor: owner, id, factId: 'acme.routing', text: 'Rebuilt lead routing for the 6-person sales team, cutting manual triage from 40 to 5 minutes a day across 1,200 weekly leads.' });
  changeSelection(root, { actor: owner, id, factId: 'tool.speed', action: 'drop' });
  const pk = getPacket(root, id, owner);
  assert.ok(!pk.sections.some((s) => s.bullets.some((b) => b.id === 'tool.speed')));
  assert.ok(pk.pool.some((x) => x.id === 'tool.speed'));
  assert.match(pk.sections.find((s) => s.entity.id === 'acme').bullets[0].text, /for the 6-person sales team/);
});

test("an editor's packet goes to the owner's queue and needs a passing check to approve", () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const id = createPacket(root, { actor: editor, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst' });
  submitForReview(root, { actor: editor, id });
  assert.throws(() => setBullet(root, { actor: editor, id, factId: 'acme.routing', text: 'x'.repeat(40) }), /waiting for review/);
  assert.ok(queue(root).some((x) => x.key === `packet:${id}`));
  assert.throws(() => decide(root, { actor: owner, key: `packet:${id}`, outcome: 'accept' }), /check/);
  checkPacket(root, { actor: owner, id });
  decide(root, { actor: owner, key: `packet:${id}`, outcome: 'accept' });
  assert.equal(getPacket(root, id, owner).status, 'ready');
  assert.throws(() => markReady(root, { actor: editor, id }), /permission/);
});

test('a cover letter figure no confirmed fact states is flagged', () => {
  const root = makeRoot();
  const p = loadProfile(root);
  const flags = coverCheck(p, 'At Acme I cut triage from 40 to 5 minutes a day. I also grew revenue 300% in a quarter.');
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].figures, ['300']);
});

test('the digest reads in English and Japanese', () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const id = createPacket(root, { actor: editor, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst' });
  submitForReview(root, { actor: editor, id });
  const d = digest(root);
  assert.equal(d.packets.inReview.length, 1);
  assert.match(digestText(d, 'en'), /1 waiting for Owner's review/);
  assert.match(digestText(d, 'ja'), /本人の確認待ち：1件/);
  assert.match(digestText(d, 'ja'), /Mom \(\d\)/);
  assert.ok(owner);
});

test('marking a packet sent creates the tracker on first use and lands the row as Applied', () => {
  const root = makeRoot();
  const { owner } = people(root);
  assert.equal(readTracker(root).rows.length, 0);
  const id = createPacket(root, { actor: owner, company: 'Example Co', role: 'Ops Intern', url: 'https://example.com/jobs/1', jdText: JD, archetype: 'analyst' });
  assert.throws(() => markSent(root, { actor: owner, id }), /check/);
  assert.equal(checkPacket(root, { actor: owner, id }).ok, true);
  const r = markSent(root, { actor: owner, id, on: '2026-10-12' });
  const rows = readTracker(root).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, 'Example Co');
  assert.equal(rows[0].status, 'Applied');
  assert.equal(r.num, rows[0].num);
  assert.equal(getPacket(root, id, owner).status, 'sent');
});

test('a Japanese packet carries only confirmed Japanese, traced to it, with Japanese style rules', () => {
  const root = makeRoot();
  const { owner } = people(root);
  // Nothing has confirmed Japanese yet: the packet says what's missing instead of inventing it.
  const empty = createPacket(root, { actor: owner, company: 'Example KK', role: '長期インターン', jdText: JD, archetype: 'analyst', lang: 'ja' });
  const pk0 = getPacket(root, empty, owner);
  assert.equal(pk0.count, 0);
  assert.ok(pk0.missingJa.some((x) => x.id === 'acme.routing' && x.review === 'draft:ja:acme.routing'));
  decide(root, { actor: owner, key: 'draft:ja:acme.routing', outcome: 'accept' });
  const id = createPacket(root, { actor: owner, company: 'Example KK', role: '長期インターン', jdText: JD, archetype: 'analyst', lang: 'ja' });
  const pk = getPacket(root, id, owner);
  const draft = read(root, readManifest(root, pk.manifest.name).output);
  assert.match(draft, /# 職務経歴書 -- Test Candidate/);
  assert.match(draft, /<!-- fact:acme\.routing\/ja -->/);
  assert.equal(checkPacket(root, { actor: owner, id }).ok, true);
  // A Japanese rewording that changes a counter fails the trace.
  setBullet(root, { actor: owner, id, factId: 'acme.routing', text: '6名チームのリード振り分けを再構築し、週1,200件のリードの手作業を1日40分から3分に短縮。' });
  const bad = checkPacket(root, { actor: owner, id });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((x) => /numbers changed/.test(x)));
  assert.throws(() => changeSelection(root, { actor: owner, id, factId: 'tool.speed', action: 'add' }), /no confirmed Japanese/);
});

test('written answers are counted by grapheme, held to their limit, and figure-checked', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const id = createPacket(root, { actor: owner, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst' });
  setAnswers(root, { actor: owner, id, answers: [
    { question: '自己PR', limit: 20, unit: 'chars', text: 'あ'.repeat(25) },
    { question: 'Why us?', limit: 50, unit: 'words', text: 'I cut triage from 40 to 5 minutes a day and grew revenue 300%.' },
  ] });
  const pk = getPacket(root, id, owner);
  assert.equal(pk.answers[0].check.used, 25);
  assert.equal(pk.answers[0].check.over, true);
  assert.deepEqual(pk.answers[1].check.flags[0].figures, ['300']);
  const r = checkPacket(root, { actor: owner, id });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((x) => /over the limit/.test(x)));
  assert.ok(r.problems.some((x) => /no confirmed fact states 300/.test(x)));
});

test('a 職務経歴書 prints the Japanese header, Japanese dates, and keeps certifications', async () => {
  const { setCandidateJa, jaHeaderGaps } = await import('../core/candidate.mjs');
  const root = makeRoot();
  const { owner, editor } = people(root);
  assert.deepEqual(jaHeaderGaps(root), ['name', 'availability']);
  assert.throws(() => setCandidateJa(root, { actor: editor, values: { name: '試験 太郎' } }), /permission/);
  setCandidateJa(root, { actor: owner, values: { name: '試験 太郎', availability: '6ヶ月の長期インターン（2027年1月〜6月）' } });
  assert.deepEqual(jaHeaderGaps(root), []);
  decide(root, { actor: owner, key: 'draft:ja:acme.routing', outcome: 'accept' });
  const { render } = await import('../core/render.mjs');
  const { loadProfile: load } = await import('../core/facts.mjs');
  const text = render(load(root), { lang: 'ja' }).text;
  assert.match(text, /# 職務経歴書 -- 試験 太郎/);
  assert.match(text, /\*\*就業可能期間:\*\* 6ヶ月の長期インターン（2027年1月〜6月）/);
  assert.match(text, /2026年5月〜2026年8月/);
  assert.doesNotMatch(text, /co-op/);
});
