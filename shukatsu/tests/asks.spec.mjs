import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'crypto';

// A throwaway key, so no test touches the Keychain or the real key file.
process.env.SHUKATSU_SYNC_KEY = randomBytes(32).toString('base64');
process.env.SHUKATSU_URL = 'https://shukatsu.example.net';

const { run, sessionPrincipal, tokenPrincipal } = await import('../core/ops/index.mjs');
const { acceptInvite, createAgent, createInvite, issueToken } = await import('../core/people.mjs');
const { createPacket, getPacketRow, setAnswers } = await import('../core/packets.mjs');
const { loadProfile } = await import('../core/facts.mjs');
const { queue } = await import('../core/review.mjs');
const { settle, getAskRow } = await import('../core/asks.mjs');
const { parse } = await import('../core/store.mjs');
const connectors = await import('../connectors/index.mjs');
const line = await import('../connectors/line/index.mjs');
const { makeRoot, people } = await import('./helpers.mjs');

const JD = 'We need an operations intern to own lead routing and KPI dashboards for our sales team.';
const Q = '学生時代に力を入れたことは何ですか。（200字以内）';
const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = 'line-channel-access-token-value';
const BOT_INFO = { userId: 'Ubot0000000000000000000000000000', basicId: '@123abcde', displayName: 'shukatsu' };

function fakeLine() {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/v2/bot/info')) return new Response(JSON.stringify(BOT_INFO), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return { fetch, pushes: () => calls.filter((c) => c.url.endsWith('/push')).map((c) => ({ to: c.body.to, text: c.body.messages[0].text })) };
}

const answersOf = (root, id) => parse(getPacketRow(root, id).answers);

function setup() {
  const root = makeRoot();
  const cast = people(root);
  const dadToken = createInvite(root, { actor: cast.owner, role: 'viewer', name: 'Dad', lang: 'ja' });
  const dad = acceptInvite(root, dadToken, { login: 'dad', password: 'a viewer password here' });
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code on the laptop' });
  const { token } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  const packet = createPacket(root, { actor: cast.owner, company: 'Example Co', role: 'Ops Intern', jdText: JD, archetype: 'analyst', lang: 'ja' });
  setAnswers(root, { actor: cast.owner, id: packet, answers: [
    { question: '志望動機', limit: 400, unit: 'chars', text: '御社の事業に惹かれました。' },
    { question: Q, limit: 200, unit: 'chars', text: 'リード振り分けを作り直しました。' },
  ] });
  const p = (u) => sessionPrincipal(u);
  const [q1, q2] = answersOf(root, packet).map((a) => `packet:${packet}#${a.id}`);
  return { root, ...cast, dad, packet, q1, q2, owner_: p(cast.owner), mom: p(cast.editor), mentor: p(cast.reviewer), dad_: p(dad), agentP: tokenPrincipal(root, token) };
}

test('only the candidate asks, and only someone who can do the job', async () => {
  const s = setup();
  const subject = s.q2;
  await assert.rejects(run(s.root, s.mom, 'ask.create', { to: s.reviewer.id, subject }), /permission|not allowed|can't/i);
  await assert.rejects(run(s.root, s.agentP, 'ask.create', { to: s.editor.id, subject }), /agent|not available|app/i);
  // A viewer doesn't see the work, and a reviewer can't suggest wording for the record.
  await assert.rejects(run(s.root, s.owner_, 'ask.create', { to: s.dad.id, subject }), /can see your applications/);
  await assert.rejects(run(s.root, s.owner_, 'ask.create', { to: s.reviewer.id, subject: 'fact:acme.routing/ja' }), /Ask an editor/);
  await assert.rejects(run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: `packet:${s.packet}#a00000000` }), /no longer on the packet/);
  await assert.rejects(run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: `packet:${s.packet}#a2` }), /doesn't match/);

  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject, note: '敬語を見てほしい' });
  await assert.rejects(run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject }), /already has this one/);
  // The reviewer may be asked about an answer too, separately.
  await run(s.root, s.owner_, 'ask.create', { to: s.reviewer.id, subject });

  const k = await run(s.root, s.mom, 'ask.get', { id });
  assert.equal(k.base.question, Q);
  assert.equal(k.base.text, 'リード振り分けを作り直しました。');
  assert.equal(k.note, '敬語を見てほしい');
  // Each person sees only what was asked of them; the candidate sees all of it.
  assert.equal((await run(s.root, s.mom, 'ask.list', {})).asks.length, 1);
  assert.equal((await run(s.root, s.owner_, 'ask.list', {})).asks.length, 2);
  await assert.rejects(run(s.root, s.mentor, 'ask.get', { id }), /for someone else/);
  await assert.rejects(run(s.root, s.mentor, 'ask.reply', { id, text: '別の答え' }), /for someone else/);
});

test('an answer the candidate uses replaces that answer on the packet, found by its question', async () => {
  const s = setup();
  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
  await assert.rejects(run(s.root, s.owner_, 'ask.close', { id, outcome: 'used' }), /Only an answered ask/);
  const better = 'チームのリード振り分けを見直し、手作業の時間を大きく減らしました。';
  assert.equal((await run(s.root, s.mom, 'ask.reply', { id, text: better, note: '「作り直した」より具体的に' })).status, 'answered');
  // Answering again before the candidate acts replaces the reply.
  await run(s.root, s.mom, 'ask.reply', { id, text: `${better}。` });
  await run(s.root, s.mom, 'ask.reply', { id, text: better });
  // The form's questions were reordered in the meantime: the answer still lands on its own question.
  const now = answersOf(s.root, s.packet);
  setAnswers(s.root, { actor: s.owner, id: s.packet, answers: [now[1], now[0]] });
  await run(s.root, s.owner_, 'ask.close', { id, outcome: 'used', note: 'ありがとう、使います' });
  const after = answersOf(s.root, s.packet);
  assert.equal(after[0].question, Q);
  assert.equal(after[0].text, better);
  assert.equal(after[1].text, '御社の事業に惹かれました。');
  const k = await run(s.root, s.mom, 'ask.get', { id });
  assert.equal(k.status, 'closed');
  assert.equal(k.outcome, 'used');
  assert.equal(k.close_note, 'ありがとう、使います');
  assert.equal(k.result.replaced, 'リード振り分けを作り直しました。');
  await assert.rejects(run(s.root, s.mom, 'ask.reply', { id, text: 'もう一度' }), /already closed/);
});

test('an asked answer is found by its id, whatever happens to the questions around it', async () => {
  const s = setup();
  const [first, second] = answersOf(s.root, s.packet);
  // Asked about answer 2; answer 1 is then deleted, so it moves up a place. The reply still finds it,
  // and a reply that matches its own text (not answer 1's) reads as "fine".
  const a = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
  setAnswers(s.root, { actor: s.owner, id: s.packet, answers: [second] });
  assert.deepEqual(await run(s.root, s.mom, 'ask.reply', { id: a.id, text: second.text }), { status: 'closed', outcome: 'fine' });

  // A question renamed, sent back with its id, is still the same answer.
  const b = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
  await run(s.root, s.mom, 'ask.reply', { id: b.id, text: '振り分けの流れを見直しました。' });
  setAnswers(s.root, { actor: s.owner, id: s.packet, answers: [{ ...first, id: undefined }, { ...second, question: 'ガクチカ' }] });
  await run(s.root, s.owner_, 'ask.close', { id: b.id, outcome: 'used' });
  const now = answersOf(s.root, s.packet);
  assert.equal(now[1].question, 'ガクチカ');
  assert.equal(now[1].text, '振り分けの流れを見直しました。');
  assert.equal(now[0].text, first.text);
  assert.notEqual(now[0].id, first.id, 'an answer sent without its id is a new answer');
});

test('two blank answers: deleting the asked one never sends its reply to the other', async () => {
  const s = setup();
  setAnswers(s.root, { actor: s.owner, id: s.packet, answers: [{ question: '自己PR', limit: 400, unit: 'chars', text: '' }, { question: '志望動機', limit: 400, unit: 'chars', text: '' }] });
  const [pr, motive] = answersOf(s.root, s.packet);
  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: `packet:${s.packet}#${pr.id}`, note: '書いてみてほしい' });
  await run(s.root, s.mom, 'ask.reply', { id, text: '私の強みは、粘り強さです。' });
  setAnswers(s.root, { actor: s.owner, id: s.packet, answers: [motive] });
  await assert.rejects(run(s.root, s.owner_, 'ask.close', { id, outcome: 'used' }), /no longer on the packet/);
  await assert.rejects(run(s.root, s.mom, 'ask.reply', { id, text: 'もう一案' }), /no longer on the packet/);
  assert.equal(answersOf(s.root, s.packet)[0].text, '');
});

test('an ask made before answers had ids is pointed at the answer in its place, or withdrawn', async () => {
  const s = setup();
  const { db, MIGRATIONS } = await import('../core/store.mjs');
  const d = db(s.root);
  const [, second] = answersOf(s.root, s.packet);
  const legacy = (subject) => Number(d.prepare(`INSERT INTO asks (subject, asked_by, asked_of, base, created_at, updated_at) VALUES (?, ?, ?, '{"text":""}', 'now', 'now')`).run(subject, s.owner.id, s.editor.id).lastInsertRowid);
  const kept = legacy(`packet:${s.packet}#a2`);
  const gone = legacy(`packet:${s.packet}#a7`);
  MIGRATIONS[8](d);
  assert.equal(getAskRow(s.root, kept).subject, `packet:${s.packet}#${second.id}`);
  assert.equal(getAskRow(s.root, gone).status, 'cancelled');
  // Today's list reads every one of them without tripping on an old subject.
  assert.equal((await run(s.root, s.owner_, 'ask.list', { status: 'live' })).asks.length, 1);
});

test('answer ids: a valid id is kept, a missing, malformed or copied one is replaced', async () => {
  const { withAnswerIds, ANSWER_ID } = await import('../core/store.mjs');
  const out = withAnswerIds([{ id: 'a0123abcd', text: 'x' }, { id: 'a0123abcd', text: 'copy' }, { id: 'nope', text: 'y' }, { text: 'z' }]);
  assert.equal(out[0].id, 'a0123abcd');
  assert.equal(new Set(out.map((a) => a.id)).size, 4);
  assert.ok(out.every((a) => ANSWER_ID.test(a.id)));
});

test('an old open ask is still listed after many newer closed ones', async () => {
  const s = setup();
  const old = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q1 });
  for (let i = 0; i < 3; i++) {
    const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
    await run(s.root, s.mom, 'ask.reply', { id, fine: true });
  }
  const { listAsks } = await import('../core/asks.mjs');
  assert.deepEqual(listAsks(s.root, s.editor, { status: 'live', limit: 2 }).map((k) => k.id), [old.id]);
  assert.equal(listAsks(s.root, s.editor, { limit: 2 }).some((k) => k.id === old.id), false);
  assert.deepEqual((await run(s.root, s.mom, 'ask.list', { status: 'open' })).asks.map((k) => k.id), [old.id]);
});

test('"fine as it is" closes the ask at once, and a set-aside answer leaves the packet alone', async () => {
  const s = setup();
  const a = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q1 });
  assert.deepEqual(await run(s.root, s.mom, 'ask.reply', { id: a.id, fine: true, note: 'これで大丈夫' }), { status: 'closed', outcome: 'fine' });
  const b = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
  await run(s.root, s.mom, 'ask.reply', { id: b.id, text: '全然ちがう答え' });
  await run(s.root, s.owner_, 'ask.close', { id: b.id, outcome: 'not_used', note: '今回は短いほうで出します' });
  assert.equal(answersOf(s.root, s.packet)[1].text, 'リード振り分けを作り直しました。');
  const c = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2 });
  await run(s.root, s.owner_, 'ask.cancel', { id: c.id });
  await assert.rejects(run(s.root, s.mom, 'ask.reply', { id: c.id, text: 'x' }), /already closed/);
});

test('a reply about a fact\'s Japanese is a proposal from that person, and the ask closes when it is decided', async () => {
  const s = setup();
  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: 'fact:acme.routing/ja', note: '自然な日本語に' });
  const k0 = await run(s.root, s.mom, 'ask.get', { id });
  assert.match(k0.base.en, /Rebuilt lead routing/);
  const wording = '6名のチームでリードの振り分けを見直し、週1,200件のリードにかかる手作業を1日40分から5分に減らしました。';
  const r = await run(s.root, s.mom, 'ask.reply', { id, text: wording });
  assert.ok(r.proposal);
  const item = queue(s.root).find((x) => x.key === `proposal:${r.proposal}`);
  assert.equal(item.author.name, 'Mom');
  assert.equal(item.part, 'ja');
  assert.deepEqual(item.warnings, []);
  // The candidate can't close it from the ask: the wording is decided in Review, with the stamp.
  await assert.rejects(run(s.root, s.owner_, 'ask.close', { id, outcome: 'used' }), /Decide the suggested wording in Review/);
  await run(s.root, s.owner_, 'review.decide', { key: `proposal:${r.proposal}`, outcome: 'accept', reason: '' });
  // Read as closed before the tick records it, then recorded by settle().
  const k = await run(s.root, s.mom, 'ask.get', { id });
  assert.equal(k.status, 'closed');
  assert.equal(k.outcome, 'used');
  assert.equal(k.result.text, wording);
  assert.equal(getAskRow(s.root, id).status, 'answered');
  assert.equal(settle(s.root), 1);
  assert.equal(getAskRow(s.root, id).status, 'closed');
  assert.equal(loadProfile(s.root)._facts.get('acme.routing').fact.ja.text, wording);
});

test('a closed fact ask keeps the wording that was stamped, even after the fact is reworded again', async () => {
  const s = setup();
  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: 'fact:acme.routing/ja' });
  const mom = '6名のチームでリードの振り分けを見直し、週1,200件のリードにかかる手作業を1日40分から5分に減らしました。';
  const r = await run(s.root, s.mom, 'ask.reply', { id, text: mom });
  await run(s.root, s.owner_, 'review.decide', { key: `proposal:${r.proposal}`, outcome: 'accept', reason: '' });
  // Before the tick records the close, the candidate rewords it once more.
  const later = await run(s.root, s.owner_, 'profile.propose', { kind: 'fact.edit', payload: { id: 'acme.routing', part: 'ja', text: '6名チームのリード振り分けを見直し、週1,200件のリードの手作業を1日40分から5分に短縮しました。' } });
  await run(s.root, s.owner_, 'review.decide', { key: later.review_key, outcome: 'accept', reason: '' });
  settle(s.root);
  assert.equal((await run(s.root, s.mom, 'ask.get', { id })).result.text, mom);
});

test('a Japanese suggestion that changes a figure is flagged in Review', async () => {
  const s = setup();
  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: 'fact:acme.routing/ja' });
  const r = await run(s.root, s.mom, 'ask.reply', { id, text: '6名チームのリード振り分けを再構築し、週1,200件のリードの手作業を1日30分から5分に短縮。' });
  const item = queue(s.root).find((x) => x.key === `proposal:${r.proposal}`);
  assert.equal(item.warnings[0].code, 'ja-numbers');
  await run(s.root, s.owner_, 'review.decide', { key: `proposal:${r.proposal}`, outcome: 'reject', reason: '数字は40分です' });
  settle(s.root);
  const k = await run(s.root, s.mom, 'ask.get', { id });
  assert.equal(k.outcome, 'not_used');
  assert.equal(k.close_note, '数字は40分です');
});

test('LINE tells the person once, with a link to the ask and nothing about the application', async () => {
  const s = setup();
  await connectors.boot(s.root);
  const { account } = await run(s.root, s.owner_, 'connector.add', { connector: 'line', label: 'LINE', channel_secret: SECRET, channel_access_token: TOKEN });
  await connectors.syncNow(s.root, account.id, { fetch: fakeLine().fetch });
  // Mom links her LINE the real way: a code from her session, sent from her LINE account.
  const { code } = await run(s.root, s.mom, 'notify.linkCode', {});
  const raw = Buffer.from(JSON.stringify({ destination: BOT_INFO.userId, events: [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'Umom' }, message: { type: 'text', id: '1', text: code } }] }));
  await line.webhook(s.root, { raw, signature: createHmac('sha256', SECRET).update(raw).digest('base64'), limited: () => false, fetch: fakeLine().fetch });

  const { id } = await run(s.root, s.owner_, 'ask.create', { to: s.editor.id, subject: s.q2, note: 'Example Coの敬語' });
  const unlinked = await run(s.root, s.owner_, 'ask.create', { to: s.reviewer.id, subject: s.q2 });
  const net = fakeLine();
  await line.deliverDue(s.root, { fetch: net.fetch });
  const pushes = net.pushes();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].to, 'Umom');
  assert.equal(pushes[0].text, `見てほしいものが1件届いています。\nhttps://shukatsu.example.net/ask/${id}`);
  assert.doesNotMatch(pushes[0].text, /Example|Ops|敬語|Owner/);
  assert.equal(getAskRow(s.root, unlinked.id).nudge, 'unlinked');
  // Once only.
  await line.deliverDue(s.root, { fetch: net.fetch });
  assert.equal(net.pushes().length, 1);

  await run(s.root, s.mom, 'ask.reply', { id, text: 'もっと丁寧な答え' });
  await line.deliverDue(s.root, { fetch: net.fetch });
  assert.equal(net.pushes().length, 1, 'her own reply is no news to her');
  await run(s.root, s.owner_, 'ask.close', { id, outcome: 'used' });
  await connectors.syncDue(s.root, { fetch: net.fetch });
  assert.equal(net.pushes().length, 2);
  assert.equal(net.pushes()[1].text, `見てもらった件が採用されました。\nhttps://shukatsu.example.net/ask/${id}`);
});
