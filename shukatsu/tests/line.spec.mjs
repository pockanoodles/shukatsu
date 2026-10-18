import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

// A throwaway key, so no test touches the Keychain or the real key file.
process.env.SHUKATSU_SYNC_KEY = randomBytes(32).toString('base64');
process.env.SHUKATSU_URL = 'https://shukatsu.example.net';

const { run, sessionPrincipal, tokenPrincipal } = await import('../core/ops/index.mjs');
const { acceptInvite, createAgent, createInvite, disableUser, issueToken } = await import('../core/people.mjs');
const { addTrackerRow } = await import('../core/tracker.mjs');
const { makeCtx } = await import('../core/http.mjs');
const { db } = await import('../core/store.mjs');
const { stateDir } = await import('../core/lock.mjs');
const sync = await import('../core/sync.mjs');
const notify = await import('../core/notify.mjs');
const connectors = await import('../connectors/index.mjs');
const line = await import('../connectors/line/index.mjs');
const { makeRoot, people } = await import('./helpers.mjs');

const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = 'line-channel-access-token-value';
// The shape of GET /v2/bot/info in the Messaging API reference.
const BOT_INFO = { userId: 'Ubot0000000000000000000000000000', basicId: '@123abcde', displayName: 'shukatsu', chatMode: 'bot', markAsReadMode: 'auto' };

/** A fake LINE: answers like the Messaging API, records every call and its decoded body. */
function fakeLine({ status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: opts.method || 'GET', auth: opts.headers?.Authorization, body });
    if (status !== 200) return new Response(JSON.stringify({ message: 'Authentication failed. Confirm that the access token in the authorization header is valid.' }), { status });
    if (String(url).endsWith('/v2/bot/info')) return new Response(JSON.stringify(BOT_INFO), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return { fetch, calls, texts: () => calls.filter((c) => c.body?.messages).map((c) => ({ to: c.body.to, replyToken: c.body.replyToken, text: c.body.messages[0].text })) };
}

/** The daemon's limiter is one per process; each test gets its own, so one test's guesses don't spend another's. */
let limited = null;
function freshLimiter() {
  const windows = new Map();
  limited = (key, max) => { const n = (windows.get(key) || 0) + 1; windows.set(key, n); return n > max; };
}

const sign = (raw, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('base64');
const message = (userId, text, extra = {}) => ({ type: 'message', replyToken: `r-${Math.random()}`, source: { type: 'user', userId }, message: { type: 'text', id: '1', text }, deliveryContext: { isRedelivery: false }, ...extra });

async function deliver(root, events, { secret = SECRET, net = fakeLine() } = {}) {
  const raw = Buffer.from(JSON.stringify({ destination: BOT_INFO.userId, events }));
  const out = await line.webhook(root, { raw, signature: sign(raw, secret), limited, fetch: net.fetch });
  return { ...out, net };
}

async function setup({ connect = true } = {}) {
  freshLimiter();
  const root = makeRoot();
  const cast = people(root);
  const dadToken = createInvite(root, { actor: cast.owner, role: 'viewer', name: 'Dad', lang: 'ja' });
  const dad = acceptInvite(root, dadToken, { login: 'dad', password: 'a viewer password here' });
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code on the laptop' });
  const { token } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  const s = {
    root, ...cast, dad, ownerP: sessionPrincipal(cast.owner), editorP: sessionPrincipal(cast.editor), dadP: sessionPrincipal(dad),
    agentP: tokenPrincipal(root, token),
  };
  await connectors.boot(root);
  if (connect) {
    const { account } = await run(root, s.ownerP, 'connector.add', { connector: 'line', label: 'LINE', channel_secret: SECRET, channel_access_token: TOKEN });
    s.account = account;
    await connectors.syncNow(root, account.id, { fetch: fakeLine().fetch });
  }
  return s;
}

/** Link a person the real way: a code from their session, sent from their LINE account. */
async function link(s, principal, userId) {
  const { code } = await run(s.root, principal, 'notify.linkCode', {});
  const out = await deliver(s.root, [message(userId, code)]);
  assert.match(out.net.texts()[0].text, /連携しました|^Linked/);
  return out;
}

// ---------------------------------------------------------------- settings

test('LINE needs a real channel secret and a token, and defaults to a Sunday 9:00 Tokyo nudge', () => {
  assert.throws(() => line.prepare({ channel_access_token: TOKEN }), /channel secret and the channel access token/);
  assert.throws(() => line.prepare({ channel_secret: 'not-a-secret', channel_access_token: TOKEN }), /32 letters and digits/);
  assert.throws(() => line.prepare({ channel_secret: SECRET, channel_access_token: TOKEN, timezone: 'Mars/Olympus' }), /isn't a time zone/);
  const p = line.prepare({ channel_secret: SECRET, channel_access_token: TOKEN });
  assert.deepEqual(p.settings, { mode: 'nudge', weekday: 0, hour: 9, timezone: 'Asia/Tokyo' });
  assert.deepEqual(p.secret, { channel_secret: SECRET, channel_access_token: TOKEN });
  // Changing the schedule keeps the credential, and doesn't touch a paused account's status.
  const next = line.prepare({ hour: 20 }, { settings: p.settings, secret: p.secret });
  assert.equal(next.settings.hour, 20);
  assert.equal(next.secret.channel_access_token, TOKEN);
  assert.equal(next.status, undefined);
});

test('the daily check learns the add-friend link, and a refused token is reported on the account', async () => {
  const s = await setup();
  assert.equal(line.addFriendUrl(s.root), 'https://line.me/R/ti/p/%40123abcde');
  const bad = fakeLine({ status: 401 });
  const out = await connectors.syncNow(s.root, s.account.id, { fetch: bad.fetch });
  assert.equal(out.ok, false);
  assert.match(out.error, /refused the channel access token/);
  assert.doesNotMatch(out.error, new RegExp(TOKEN));
  assert.equal(bad.calls[0].auth, `Bearer ${TOKEN}`);
});

// ---------------------------------------------------------------- linking

test('a person links their own LINE account with a code, and LINE answers in their language', async () => {
  const s = await setup();
  const status = await run(s.root, s.editorP, 'notify.status', {});
  assert.equal(status.line.linked, false);
  assert.equal(status.line.add_friend_url, 'https://line.me/R/ti/p/%40123abcde');

  const { code, expires_at, add_friend_url } = await run(s.root, s.editorP, 'notify.linkCode', {});
  assert.match(code, /^\d{6}$/);
  assert.ok(Date.parse(expires_at) - Date.now() <= 15 * 60_000);
  assert.ok(add_friend_url);
  // Kept hashed: the code itself is nowhere in app.db.
  assert.equal(db(s.root).prepare('SELECT COUNT(*) AS n FROM notify_codes WHERE code_hash = ?').get(code).n, 0);

  const { net } = await deliver(s.root, [message('Umom', code)]);
  const [said] = net.texts();
  assert.match(said.text, /^Momさん、連携しました/);
  assert.equal((await run(s.root, s.editorP, 'notify.status', {})).line.linked, true);

  // The owner sees who is linked, never the LINE id.
  const { people: linked } = await run(s.root, s.ownerP, 'notify.recipients', {});
  assert.deepEqual(linked.map((p) => [p.name, p.active]), [['Mom', true]]);
  assert.doesNotMatch(JSON.stringify(linked), /Umom/);
});

test('a code works once, expires, accepts full-width digits, and asking again replaces it', async () => {
  const s = await setup();
  const first = (await run(s.root, s.dadP, 'notify.linkCode', {})).code;
  const second = (await run(s.root, s.dadP, 'notify.linkCode', {})).code;
  if (first !== second) assert.match((await deliver(s.root, [message('Udad1', first)])).net.texts()[0].text, /コードが違う/);

  const wide = second.replace(/\d/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  assert.match((await deliver(s.root, [message('Udad1', wide)])).net.texts()[0].text, /連携しました/);
  assert.match((await deliver(s.root, [message('Udad2', second)])).net.texts()[0].text, /コードが違う/);

  const late = (await run(s.root, s.dadP, 'notify.linkCode', {})).code;
  db(s.root).prepare('UPDATE notify_codes SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  assert.match((await deliver(s.root, [message('Udad3', late)])).net.texts()[0].text, /期限/);
  assert.equal(notify.recipients(s.root).find((p) => p.name === 'Dad').address, 'Udad1');
});

test('guessing is rate-limited per LINE account, and other text gets the notify-only reply', async () => {
  const s = await setup();
  const guesses = Array.from({ length: 6 }, (_, i) => message('Uguesser', String(100000 + i)));
  const said = (await deliver(s.root, guesses)).net.texts().map((t) => t.text);
  assert.equal(said.filter((t) => /コードが違う/.test(t)).length, 5);
  assert.match(said[5], /試行が多すぎます/);
  assert.match((await deliver(s.root, [message('Uchatty', '今日はどうだった？')])).net.texts()[0].text, /お知らせ専用/);
});

test('the webhook refuses a bad signature, ignores groups and redeliveries, and forgets a LINE account that leaves', async () => {
  const s = await setup();
  const { code } = await run(s.root, s.editorP, 'notify.linkCode', {});
  const forged = await deliver(s.root, [message('Uevil', code)], { secret: 'f'.repeat(32) });
  assert.equal(forged.status, 401);
  assert.equal(forged.net.calls.length, 0);

  const group = await deliver(s.root, [{ ...message('Ugroup', code), source: { type: 'group', groupId: 'C1', userId: 'Ugroup' } }]);
  const redelivered = await deliver(s.root, [message('Uretry', code, { deliveryContext: { isRedelivery: true } })]);
  assert.equal(group.net.calls.length + redelivered.net.calls.length, 0);
  assert.equal(notify.links(s.root).length, 0);

  await deliver(s.root, [message('Umom', code)]);
  assert.equal(notify.links(s.root).length, 1);
  await deliver(s.root, [{ type: 'unfollow', source: { type: 'user', userId: 'Umom' } }]);
  assert.equal(notify.links(s.root).length, 0);

  const welcome = await deliver(s.root, [{ type: 'follow', replyToken: 'r1', source: { type: 'user', userId: 'Unew' } }]);
  assert.match(welcome.net.texts()[0].text, /6桁のコード/);
  assert.equal(welcome.net.calls[0].url, 'https://api.line.me/v2/bot/message/reply');
});

test('with no LINE account the webhook is not found, and nobody can ask for a code', async () => {
  const s = await setup({ connect: false });
  const raw = Buffer.from('{"events":[]}');
  assert.equal((await line.webhook(s.root, { raw, signature: sign(raw), limited })).status, 404);
  await assert.rejects(run(s.root, s.editorP, 'notify.linkCode', {}), (e) => e.code === 'not_connected');
});

// ---------------------------------------------------------------- who may do what

test('linking is a person\'s own stamp; sending and unlinking others are the owner\'s', async () => {
  const s = await setup();
  for (const name of ['notify.linkCode', 'notify.send', 'notify.unlink', 'notify.status', 'notify.recipients']) {
    await assert.rejects(run(s.root, s.agentP, name, {}), (e) => ['stamp_required', 'denied'].includes(e.code), name);
  }
  await link(s, s.editorP, 'Umom');
  await link(s, s.dadP, 'Udad');
  await assert.rejects(run(s.root, s.editorP, 'notify.send', {}), (e) => e.code === 'stamp_required' || e.code === 'denied');
  await assert.rejects(run(s.root, s.editorP, 'notify.recipients', {}), (e) => e.code === 'stamp_required' || e.code === 'denied');
  await assert.rejects(run(s.root, s.editorP, 'notify.unlink', { user_id: s.dad.id }), (e) => e.code === 'denied');

  assert.deepEqual(await run(s.root, s.dadP, 'notify.unlink', {}), { unlinked: true });
  assert.deepEqual(await run(s.root, s.ownerP, 'notify.unlink', { user_id: s.editor.id }), { unlinked: true });
  assert.equal(notify.links(s.root).length, 0);
});

// ---------------------------------------------------------------- the digest

/** One application that moved this week, so the full digest has a company to name. */
async function seed(s) {
  const { num } = addTrackerRow(s.root, { company: 'Acme Robotics', role: 'Operations Analyst Intern', status: 'Applied', url: 'https://jobs.acmerobotics.com/roles/12' });
  await run(s.root, s.ownerP, 'tracker.setStatus', { num, state: 'Interview' });
}

test('a nudge carries counts and a link, never a company; full carries the digest, each in the reader\'s language', async () => {
  const s = await setup();
  await seed(s);
  await link(s, s.editorP, 'Umom');
  await link(s, s.ownerP, 'Uowner');

  const net = fakeLine();
  const sent = await line.sendDigest(s.root, { fetch: net.fetch });
  assert.deepEqual(sent, { mode: 'nudge', sent: 2, failed: 0, error: null });
  const byTo = Object.fromEntries(net.texts().map((t) => [t.to, t.text]));
  assert.match(byTo.Umom, /^就活レポート/);
  assert.match(byTo.Umom, /詳しくはアプリで：https:\/\/shukatsu\.example\.net\/digest/);
  assert.match(byTo.Uowner, /^shukatsu, /);
  for (const text of Object.values(byTo)) assert.doesNotMatch(text, /Acme|Operations Analyst|Mom|Owner/);

  await run(s.root, s.ownerP, 'connector.update', { id: s.account.id, mode: 'full' });
  const full = fakeLine();
  const out = await line.sendDigest(s.root, { userId: s.editor.id, fetch: full.fetch });
  assert.deepEqual([out.mode, out.sent], ['full', 1]);
  assert.match(full.texts()[0].text, /Acme Robotics/);
  assert.equal(full.texts()[0].to, 'Umom');
});

test('the weekly push goes out once at the chosen hour, skips other days, and never reaches someone cut off', async () => {
  const s = await setup();
  await seed(s);
  await link(s, s.editorP, 'Umom');
  await link(s, s.dadP, 'Udad');
  disableUser(s.root, { actor: s.owner, id: s.dad.id });

  // Sunday 2026-10-18 in Tokyo: 08:59 is early, 09:00 sends, 09:01 has already sent.
  const at = (iso) => Date.parse(iso);
  const net = fakeLine();
  assert.equal(await line.deliverDue(s.root, { fetch: net.fetch, nowMs: at('2026-10-17T23:59:00Z') }), null);
  const out = await line.deliverDue(s.root, { fetch: net.fetch, nowMs: at('2026-10-18T00:00:00Z') });
  assert.deepEqual([out.sent, out.failed], [1, 0]);
  assert.deepEqual(net.texts().map((t) => t.to), ['Umom']);
  assert.equal(await line.deliverDue(s.root, { fetch: net.fetch, nowMs: at('2026-10-18T00:01:00Z') }), null);
  // Saturday in Tokyo sends nothing.
  assert.equal(await line.deliverDue(s.root, { fetch: net.fetch, nowMs: at('2026-10-24T03:00:00Z') }), null);
  // syncDue runs it too, and a paused account sends nothing.
  await run(s.root, s.ownerP, 'connector.update', { id: s.account.id, paused: true });
  await connectors.syncDue(s.root, { fetch: net.fetch, nowMs: at('2026-10-25T00:00:00Z') });
  assert.equal(net.texts().length, 1);
});

test('every LINE request is pinned to api.line.me and logged without the token or the message', async () => {
  const s = await setup();
  await seed(s);
  await link(s, s.editorP, 'Umom');
  await line.sendDigest(s.root, { fetch: fakeLine().fetch });
  const log = readFileSync(join(stateDir(s.root), 'egress.log'), 'utf-8');
  const lines = log.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.connector === 'line');
  assert.deepEqual([...new Set(lines.map((l) => l.host))], ['api.line.me']);
  assert.deepEqual([...new Set(lines.map((l) => l.purpose))].sort(), ['line.digest', 'line.info', 'line.reply']);
  assert.doesNotMatch(log, new RegExp(`${TOKEN}|Umom|就活|連携`));
  assert.ok(!existsSync(join(s.root, 'data', 'line')));
});

// ---------------------------------------------------------------- the route

test('the daemon routes LINE\'s webhook by POST, with the raw body for the signature', async () => {
  const s = await setup();
  const call = async (method, raw, signature) => {
    const req = Object.assign(Readable.from(raw ? [raw] : []), {
      url: '/connectors/line/webhook', method,
      headers: { host: 'shukatsu.example.net', 'x-forwarded-proto': 'https', ...(signature ? { 'x-line-signature': signature } : {}) },
      socket: { remoteAddress: '203.0.113.9' },
    });
    const out = { status: null };
    const res = { headersSent: false, writeHead(status) { out.status = status; this.headersSent = true; }, end() {} };
    const handled = await connectors.handleConnector(req, res, makeCtx(req, res, { root: s.root }), { fetch: fakeLine().fetch });
    return { handled, status: out.status };
  };
  assert.deepEqual(await call('GET'), { handled: true, status: 405 });
  const raw = Buffer.from('{"destination":"U","events":[]}');
  assert.deepEqual(await call('POST', raw, sign(raw)), { handled: true, status: 200 });
  assert.deepEqual(await call('POST', raw, 'bm9wZQ=='), { handled: true, status: 401 });
  // The account check and the push stay off sync.db's copies: LINE keeps no records.
  assert.equal(sync.listRecords(s.root, { connector: 'line' }).length, 0);
});
