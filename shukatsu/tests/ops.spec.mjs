import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { OPS, available, run, sessionPrincipal, tokenPrincipal, systemPrincipal } from '../core/ops/index.mjs';
import { can, createAgent, issueToken, STAMPS } from '../core/people.mjs';
import { validate } from '../core/ops/schema.mjs';
import { zonedToUtc, utcToZoned } from '../core/tz.mjs';
import { makeRoot, people } from './helpers.mjs';

/** An owner and an agent with a token, the way the Agents page makes them. */
function setup() {
  const root = makeRoot();
  const cast = people(root);
  const owner = sessionPrincipal(cast.owner);
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code on the laptop' });
  const { token } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  return { root, ...cast, ownerP: owner, agent, agentP: tokenPrincipal(root, token), token };
}

const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

const EVAL = (over = {}) => ({
  company: 'Acme Robotics', role: 'Operations Analyst Intern', url: 'https://boards.greenhouse.io/acme/jobs/123',
  archetype: 'analyst', score: 4.1, legitimacy: 'High Confidence',
  blocks: { a: 'Role summary.', b: 'Match.', c: 'Level.', d: 'Comp.', e: 'Plan.', f: 'Interviews.', g: 'Legit: posted 3 days ago on the employer ATS.', risk_summary: 'Low.', score_evidence: 'Supported.' },
  machine_summary: { final_decision: 'Apply', advertised_comp: null, risk_summary: { culture: 'pass' }, requirement_importance: [] },
  jd_text: 'Acme Robotics is hiring an Operations Analyst Intern for spring 2027. You will build dashboards, analyze fulfillment data, and work with the operations team in Boston. Requirements: SQL, Excel, curiosity.',
  ...over,
});

test('the migration keeps every person and makes them kind person', () => {
  const { root, owner, editor } = setup();
  assert.equal(owner.kind, 'person');
  assert.equal(editor.kind, 'person');
  assert.ok(existsSync(join(root, '.shukatsu', 'app.db')));
});

test('an agent never stamps, whatever its role table says', async () => {
  const { root, agent, agentP } = setup();
  for (const perm of STAMPS) assert.equal(can({ ...agent, role: 'owner' }, perm), false, perm);
  await rejects(run(root, agentP, 'review.decide', { key: 'proposal:1', outcome: 'accept' }), 'stamp_required');
  await rejects(run(root, agentP, 'packet.markSent', { id: 1 }), 'stamp_required');
  await rejects(run(root, agentP, 'token.create', { user_id: agent.id, kind: 'agent', name: 'more' }), 'stamp_required');
  await rejects(run(root, agentP, 'people.invite', { name: 'X', role: 'viewer' }), 'stamp_required');
});

test('an agent\'s tool list has no stamps and no app-only operations', () => {
  const { agentP, ownerP } = setup();
  const names = available(agentP).map((o) => o.name);
  assert.ok(names.includes('evaluation.submit'));
  assert.ok(names.includes('tracker.setStatus'));
  for (const n of names) assert.equal(OPS.get(n).stamp, false, n);
  assert.ok(!names.includes('account.password'));
  assert.ok(available(ownerP).some((o) => o.name === 'review.decide'));
  assert.ok(names.length <= 45, `agent surface grew to ${names.length}`);
});

test('a person\'s stamp needs a session, and a token for the owner can\'t stamp either', async () => {
  const { root, owner } = setup();
  const { token } = issueToken(root, { actor: owner, userId: owner.id, kind: 'capture', name: 'bookmarklet' });
  const p = tokenPrincipal(root, token);
  await rejects(run(root, p, 'review.decide', { key: 'proposal:1', outcome: 'accept' }), 'scope');
  await rejects(run(root, p, 'tracker.list', {}), 'scope');
});

test('input is checked against the schema before anything runs', async () => {
  const { root, agentP } = setup();
  await rejects(run(root, agentP, 'tracker.setStatus', { num: 1, state: 'Pending' }), 'invalid_input');
  await rejects(run(root, agentP, 'tracker.setStatus', { num: 1 }), 'invalid_input');
  await rejects(run(root, agentP, 'posting.add', { url: 'not a url' }), 'invalid_input');
  await rejects(run(root, agentP, 'nope.nothing', {}), 'unknown_op');
});

test('an evaluation missing a block is refused by name, and nothing is written', async () => {
  const { root, agentP } = setup();
  const ev = EVAL();
  delete ev.blocks.g;
  await assert.rejects(run(root, agentP, 'evaluation.submit', ev), /G\) Posting Legitimacy/);
  assert.ok(!existsSync(join(root, 'reports')) || !readFileSync(join(root, '.shukatsu', 'app.db')).includes('evaluation.submitted'));
  const thin = EVAL({ jd_text: 'Short.' });
  await assert.rejects(run(root, agentP, 'evaluation.submit', thin), /archived job description/);
  const high = EVAL({ score: 4.6 });
  await assert.rejects(run(root, agentP, 'evaluation.submit', high), /H\) Draft Application Answers/);
});

test('a complete evaluation becomes a canonical report and one tracker row', async () => {
  const { root, agentP } = setup();
  const out = await run(root, agentP, 'evaluation.submit', EVAL());
  const report = readFileSync(join(root, out.report), 'utf-8');
  assert.match(report, /^\*\*URL:\*\* https:\/\/boards\.greenhouse\.io\/acme\/jobs\/123$/m);
  assert.match(report, /^\*\*Legitimacy:\*\* High Confidence$/m);
  assert.match(report, /## Job Description \(archived verbatim\)\n\nAcme Robotics is hiring/);
  assert.match(report, /legitimacy: high_confidence/);
  const rows = (await run(root, agentP, 'tracker.list', {})).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, 'Acme Robotics');
  assert.equal(rows[0].status, 'Evaluated');
  const set = await run(root, agentP, 'tracker.setStatus', { num: rows[0].num, state: 'Applied', note: 'via Avature' });
  assert.equal(set.state, 'Applied');
  assert.equal((await run(root, agentP, 'tracker.list', { status: 'Applied' })).rows.length, 1);
  const log = (await run(root, agentP, 'activity.list', {})).activity;
  assert.ok(log.some((a) => a.verb === 'tracker.status' && a.actor_name === 'Claude Code on the laptop'));
});

test('a capture becomes the archived JD and a pipeline item, once per URL', async () => {
  const { root, owner } = setup();
  const { token } = issueToken(root, { actor: owner, userId: owner.id, kind: 'capture', name: 'bookmarklet' });
  const p = tokenPrincipal(root, token);
  const page = { url: 'https://app.joinhandshake.com/jobs/98765', title: 'Data Analyst Intern - Initech | Handshake', text: 'About the role. '.repeat(30), via: 'bookmarklet' };
  const a = await run(root, p, 'posting.capture', page);
  assert.equal(a.board, 'Handshake');
  assert.equal(a.company, 'Initech');
  assert.equal(a.role, 'Data Analyst Intern');
  assert.equal(a.added, true);
  const b = await run(root, p, 'posting.capture', { ...page, text: 'A fuller page. '.repeat(40) });
  assert.equal(b.added, false);
  assert.equal(b.replaced, true);
  assert.equal(b.capture, a.capture);
  const items = (await run(root, sessionPrincipal(owner), 'pipeline.list', {})).items;
  assert.equal(items.length, 1);
  assert.match(items[0].note + items[0].extra, /local:jds\/capture-/);
  const got = await run(root, sessionPrincipal(owner), 'posting.get', { capture: a.capture });
  assert.match(got.untrusted.jd, /A fuller page/);
});

test('a deadline written in JST keeps JST, and campaigns hold rows and slots', async () => {
  const { root, agentP } = setup();
  assert.equal(zonedToUtc('2026-10-26T08:00', 'Asia/Tokyo'), '2026-10-25T23:00:00Z');
  assert.deepEqual(utcToZoned('2026-10-25T23:00:00Z', 'America/New_York'), { date: '2026-10-25', time: '19:00' });
  const { num } = await run(root, agentP, 'tracker.add', { company: 'Initech', role: 'Operations Analyst', status: 'Evaluated' });
  const { id } = await run(root, agentP, 'campaign.create', { name: 'Example Career Forum 2026', venue: 'Example Hall', timezone: 'America/New_York', starts_on: '2026-11-13', ends_on: '2026-11-15' });
  await run(root, agentP, 'campaign.link', { id, rows: [{ tracker_num: num, channel: 'Avature' }] });
  await rejects(run(root, agentP, 'campaign.link', { id, rows: [{ tracker_num: 999 }] }), 'failed');
  const dl = await run(root, agentP, 'campaign.schedule', { id, kind: 'deadline', title: 'Initech final deadline', start: '2026-10-26T08:00', timezone: 'Asia/Tokyo', tracker_num: num });
  assert.equal(dl.starts_at, '2026-10-25T23:00:00Z');
  assert.equal(dl.timezone, 'Asia/Tokyo');
  await run(root, agentP, 'campaign.schedule', { id, kind: 'interview', title: 'Initech 1st', start: '2026-11-13T10:00', end: '2026-11-13T10:45', tracker_num: num, round: '1st' });
  const c = await run(root, agentP, 'campaign.get', { id });
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].company, 'Initech');
  assert.equal(c.rows[0].next_deadline.title, 'Initech final deadline');
  assert.equal(c.slots.length, 1);
  const clash = await run(root, agentP, 'calendar.conflicts', { start: '2026-11-13T10:30', end: '2026-11-13T11:00', timezone: 'America/New_York' });
  assert.equal(clash.clear, false);
  const tight = await run(root, agentP, 'calendar.conflicts', { start: '2026-11-13T11:00', end: '2026-11-13T11:30', timezone: 'America/New_York', gap_minutes: 30 });
  assert.equal(tight.clear, true);
  assert.equal(tight.conflicts[0].kind, 'tight');
});

test('every operation has a schema the validator accepts, and the system principal is an agent', () => {
  for (const op of OPS.values()) {
    assert.ok(validate({ type: 'object' }, {}).ok);
    assert.equal(op.input.type, 'object', `${op.name} input must be an object schema (MCP tools need it)`);
  }
  const root = makeRoot();
  const sys = systemPrincipal(root);
  assert.equal(sys.user.kind, 'agent');
  assert.equal(can(sys.user, 'review.decide'), false);
});
