import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

process.env.SHUKATSU_SYNC_KEY = randomBytes(32).toString('base64');

const { run, sessionPrincipal, tokenPrincipal } = await import('../core/ops/index.mjs');
const { addBusySource } = await import('../core/ops/schedule.mjs');
const { createAgent, issueToken } = await import('../core/people.mjs');
const { readPipeline } = await import('../core/tracker.mjs');
const { stateDir } = await import('../core/lock.mjs');
const sync = await import('../core/sync.mjs');
const connectors = await import('../connectors/index.mjs');
const { shapeOf } = await import('../connectors/browser/index.mjs');
const { addressOnly, addressOnlyHosts, fillHosts, fromBoard, isPostingLink, pageOf, passiveHosts, platformOfSender, platformOfUrl } = await import('../platforms/index.mjs');
const { makeRoot, people, read } = await import('./helpers.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

const POSTING = 'https://app.joinhandshake.com/stu/jobs/9876543?ref=search';
const JD = `Data Analyst Co-op, Spring 2027\nGlobex Corporation · Boston, MA\n\n${'You will build dashboards and clean data for the operations team. '.repeat(12)}`;

async function setup({ connect = true } = {}) {
  const root = makeRoot();
  const cast = people(root);
  const ownerP = sessionPrincipal(cast.owner);
  const { token } = issueToken(root, { actor: cast.owner, userId: cast.owner.id, kind: 'capture', name: 'extension' });
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code' });
  const { token: agentToken } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  await connectors.boot(root, { addBusySource });
  let account = null;
  if (connect) ({ account } = await run(root, ownerP, 'connector.add', { connector: 'browser' }));
  return { root, ...cast, ownerP, account, extP: tokenPrincipal(root, token, { kinds: ['capture'] }), agentP: tokenPrincipal(root, agentToken) };
}

// ---------------------------------------------------------------- the registry

test('pages are told apart by URL, on passive boards only', () => {
  assert.deepEqual(['posting', 'handshake'], [pageOf(POSTING).kind, pageOf(POSTING).platform.id]);
  assert.equal(pageOf('https://northeastern.joinhandshake.com/stu/applications').kind, 'applications');
  assert.equal(pageOf('https://app.joinhandshake.com/stu/messages/55').kind, 'thread');
  assert.equal(pageOf('https://www.linkedin.com/jobs/view/4012345/'), null, 'no LinkedIn page is read: its terms ban software that copies its pages');
  assert.equal(pageOf('https://www.linkedin.com/feed/'), null);
  assert.equal(pageOf('https://northeastern-csm.symplicity.com/students/app/jobs/detail/abc123').kind, 'posting');
  assert.equal(pageOf('https://boards.greenhouse.io/globex/jobs/9'), null, 'an ATS is not read passively');
  assert.equal(pageOf('https://example.com/jobs/1'), null);
  assert.equal(pageOf('not a url'), null);
});

test('senders and links resolve to platforms', () => {
  assert.equal(platformOfSender('Handshake <notifications@mail.joinhandshake.com>')?.id, 'handshake');
  assert.equal(platformOfSender('jobs-noreply@linkedin.com')?.id, 'linkedin');
  assert.equal(platformOfSender('news@linkedin.com'), null, 'LinkedIn is known by its application and message senders only');
  assert.ok(fromBoard('NUworks <noreply@symplicity.com>'));
  assert.ok(!fromBoard('no-reply@greenhouse.io'), 'an ATS is not a board');
  assert.ok(isPostingLink('https://job-boards.greenhouse.io/globex/jobs/9'));
  assert.ok(!isPostingLink('https://www.linkedin.com/jobs/view/1'));
  assert.equal(platformOfUrl('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1')?.name, 'Workday');
});

test('a path folds its ids, so other pages are kept by shape', () => {
  assert.equal(shapeOf('/stu/jobs/9876543/'), '/stu/jobs/:id');
  assert.equal(shapeOf('/stu/users/sam-candidate-0a1b2c3/'), '/stu/users/:id');
  assert.equal(shapeOf('/feed/'), '/feed');
  assert.equal(shapeOf('/'), '/');
});

test('the extension asks for exactly the hosts the registry reads passively, and may fill', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', 'extension', 'manifest.json'), 'utf-8'));
  const want = passiveHosts().flatMap((h) => [`https://${h}/*`, `https://*.${h}/*`]).sort();
  assert.deepEqual([...manifest.content_scripts[0].matches].sort(), want);
  assert.equal(manifest.host_permissions, undefined, 'it reads pages through its content script and asks for no host access beyond that');
  assert.deepEqual([...manifest.optional_host_permissions].sort(), fillHosts().flatMap((h) => [`https://${h}/*`, `https://*.${h}/*`]).sort(), 'filling asks, once, for the ATS hosts the registry fills');
  assert.ok(!fillHosts().some((h) => h.includes('linkedin')), 'LinkedIn is never filled');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.equal(manifest.content_scripts[0].world ?? 'ISOLATED', 'ISOLATED', 'the reader never runs in the page\'s own world');
});

test('the extension runs nothing on a site whose pages are never copied, and its list of them is the registry\'s', () => {
  assert.deepEqual(addressOnlyHosts(), ['linkedin.com']);
  assert.ok(addressOnly('https://www.linkedin.com/jobs/view/4012345/') && !addressOnly(POSTING));
  assert.ok(!passiveHosts().some((h) => addressOnlyHosts().includes(h)), 'no never-copied host is read passively');
  const background = readFileSync(join(HERE, '..', 'extension', 'background.js'), 'utf-8');
  const listed = JSON.parse(background.match(/const NEVER_HOSTS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(listed.sort(), addressOnlyHosts().sort(), 'background.js NEVER_HOSTS mirrors platforms/');
});

// ---------------------------------------------------------------- page.observe

test('a posting page becomes a signal, and saving it archives the JD and files the posting', async () => {
  const s = await setup();
  const first = await run(s.root, s.extP, 'page.observe', { url: POSTING });
  assert.deepEqual(first, { platform: 'handshake', page: 'posting', kept: 'none', record: null, signal: null, wants_text: true }, 'a listed page asks for its text before anything is kept');
  const out = await run(s.root, s.extP, 'page.observe', { url: POSTING, title: 'Data Analyst Co-op - Globex | Handshake', text: JD, links: ['https://app.joinhandshake.com/stu/employers/1', 'javascript:void(0)'] });
  assert.equal(out.page, 'posting');
  assert.equal(out.kept, 'page');
  assert.ok(out.signal);

  const { signals, untrusted } = await run(s.root, s.ownerP, 'inbox.list', {});
  assert.equal(signals[0].kind, 'posting');
  assert.deepEqual(signals[0].proposed.actions, [{ op: 'posting.capture', input: { record: out.record } }], 'the action names the record, never its text');
  assert.equal(untrusted.items[0].from, 'Handshake');
  assert.match(untrusted.items[0].subject, /Globex/);
  assert.deepEqual(sync.getRecord(s.root, out.record).fields.links, ['https://app.joinhandshake.com/stu/employers/1']);

  const saved = await run(s.root, s.ownerP, 'posting.capture', signals[0].proposed.actions[0].input);
  assert.equal(saved.board, 'Handshake');
  assert.ok(saved.added);
  assert.match(read(s.root, saved.file), /captured_via: "extension"/);
  assert.match(read(s.root, saved.file), /You will build dashboards/);
  assert.equal(readPipeline(s.root).length, 1);

  // Seen again: the record is replaced and no second signal is made.
  const again = await run(s.root, s.extP, 'page.observe', { url: POSTING, title: 'Data Analyst Co-op - Globex | Handshake', text: `${JD} Updated.` });
  assert.equal(again.record, out.record);
  assert.equal(again.signal, out.signal);
  assert.equal((await run(s.root, s.ownerP, 'inbox.list', { status: 'all' })).signals.length, 1);
});

test('a posting already in the pipeline makes no signal', async () => {
  const s = await setup();
  await run(s.root, s.ownerP, 'posting.add', { url: POSTING });
  const out = await run(s.root, s.extP, 'page.observe', { url: POSTING, title: 'Globex', text: JD });
  assert.equal(out.signal, null);
});

test('other pages of a board are kept by path alone, with a count, and make no signal', async () => {
  const s = await setup();
  await run(s.root, s.extP, 'page.observe', { url: 'https://app.joinhandshake.com/stu/users/someone-0a1b2c3?ref=card', text: 'Someone. Their whole profile.' });
  const out = await run(s.root, s.extP, 'page.observe', { url: 'https://app.joinhandshake.com/stu/users/someone-else-9z8y7x6' });
  assert.equal(out.kept, 'path');
  const r = sync.getRecord(s.root, out.record);
  assert.equal(r.text, null, 'no text is kept for a page the registry doesn\'t list');
  assert.equal(r.fields.shape, '/stu/users/:id');
  assert.equal(r.fields.seen, 2);
  assert.equal(JSON.stringify(r.fields).includes('someone'), false);
  assert.equal((await run(s.root, s.ownerP, 'inbox.list', { status: 'all' })).signals.length, 0);
});

test('an applications list is kept as a page for the readers, with no signal yet', async () => {
  const s = await setup();
  const out = await run(s.root, s.extP, 'page.observe', { url: 'https://app.joinhandshake.com/stu/applications', title: 'Applications', text: 'Globex · Data Analyst Co-op · Applied Oct 2 · Reviewed' });
  assert.equal(out.page, 'applications');
  assert.equal(out.signal, null);
  assert.match(sync.getRecord(s.root, out.record).text, /Reviewed/);
});

test('a LinkedIn posting is filed by its address alone: text a client read there is dropped, and only a person\'s paste is kept', async () => {
  const s = await setup();
  const captures = () => (existsSync(join(s.root, 'jds')) ? readdirSync(join(s.root, 'jds')).filter((f) => f.startsWith('capture-')) : []);
  const url = 'https://www.linkedin.com/jobs/view/4012345/';
  const out = await run(s.root, s.extP, 'posting.capture', { url, via: 'extension' });
  assert.equal(out.address_only, true);
  assert.equal(out.capture, null);
  assert.equal(out.board, 'LinkedIn');
  const [item] = readPipeline(s.root);
  assert.equal(item.state, 'blocked', 'it waits for the employer\'s posting');
  assert.match(item.note, /never copied/);
  assert.deepEqual(captures(), []);

  const read = await run(s.root, s.extP, 'posting.capture', { url: 'https://www.linkedin.com/jobs/view/4099999/', title: 'Analyst | Globex | LinkedIn', text: JD, via: 'bookmarklet' });
  assert.equal(read.address_only, true, 'text a page-reading client sent from LinkedIn is not kept');
  assert.deepEqual(captures(), []);

  const pasted = await run(s.root, s.ownerP, 'posting.capture', { url: 'https://www.linkedin.com/jobs/view/4088888/', text: JD, via: 'app' });
  assert.ok(pasted.capture, 'text the candidate pasted by hand is theirs to keep');
  assert.equal(captures().length, 1);
  await rejects(run(s.root, s.ownerP, 'posting.capture', { url: POSTING, via: 'extension' }), 'invalid_input');
});

test('page.observe is refused off the boards, before the owner turns it on, while paused, and for an empty page', async () => {
  const off = await setup({ connect: false });
  await rejects(run(off.root, off.extP, 'page.observe', { url: POSTING, text: JD }), 'not_connected');

  const s = await setup();
  await rejects(run(s.root, s.extP, 'page.observe', { url: 'https://boards.greenhouse.io/globex/jobs/9', text: JD }), 'invalid_input');
  await rejects(run(s.root, s.extP, 'page.observe', { url: 'https://www.linkedin.com/jobs/view/4012345/', text: JD }), 'invalid_input');
  await rejects(run(s.root, s.extP, 'page.observe', { url: POSTING, text: 'Loading…' }), 'invalid_input');
  await run(s.root, s.ownerP, 'connector.update', { id: s.account.id, paused: true });
  await rejects(run(s.root, s.extP, 'page.observe', { url: POSTING, text: JD }), 'paused');
});

test('only the owner\'s capture key reaches page.observe: an agent is refused, and the key reaches nothing else', async () => {
  const s = await setup();
  await rejects(run(s.root, s.agentP, 'page.observe', { url: POSTING, text: JD }), 'denied');
  await rejects(run(s.root, s.extP, 'inbox.list', {}), 'scope');
});

test('the browser connector is push-only: the scheduler skips it and Sync now only reads what arrived', async () => {
  const s = await setup();
  const due = await connectors.syncDue(s.root, { fetch: async () => { throw new Error('the browser connector fetched something'); } });
  assert.equal(due.length, 0);
  const now = await run(s.root, s.ownerP, 'connector.sync', { id: s.account.id });
  assert.equal(now.ok, true);
});

test('purging the browser connector deletes its pages and their signals', async () => {
  const s = await setup();
  await run(s.root, s.extP, 'page.observe', { url: POSTING, title: 'Globex', text: JD });
  const out = await run(s.root, s.ownerP, 'connector.purge', { connector: 'browser' });
  assert.deepEqual(out, { records: 1, signals: 1 });
});

// ---------------------------------------------------------------- the migration

test('a sync.db from before page records keeps its records and signals through the rebuild', async () => {
  const root = makeRoot();
  people(root);
  const path = join(stateDir(root), 'sync.db');
  sync.syncDb(root);
  sync.closeSyncDb(root);
  // Put it back at version 1, the shape that shipped, with one record and its signal.
  const d = new DatabaseSync(path);
  d.exec(`DROP TABLE signals; DROP TABLE records;
    CREATE TABLE records (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('message', 'event', 'posting')), external_id TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '{}',
      text TEXT, fetched_at TEXT NOT NULL, processed_at TEXT, UNIQUE (account_id, external_id));
    CREATE INDEX records_kind ON records(account_id, kind);
    CREATE TABLE signals (id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL UNIQUE REFERENCES records(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('interview', 'rejection', 'assessment', 'confirmation', 'offer', 'noise', 'other')),
      tracker_num INTEGER, campaign_id INTEGER, confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),
      proposed TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'filed', 'acted')),
      proposal_id INTEGER, resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
    CREATE INDEX signals_status ON signals(status, created_at);
    INSERT INTO accounts (id, connector, label, created_at) VALUES (1, 'gmail', 'Sam', '2026-10-13T00:00:00Z');
    INSERT INTO records (id, account_id, kind, external_id, fetched_at) VALUES (7, 1, 'message', 'm1', '2026-10-13T00:00:00Z');
    INSERT INTO signals (record_id, kind, created_at) VALUES (7, 'interview', '2026-10-13T00:00:00Z');
    UPDATE schema_version SET version = 1;`);
  d.close();

  sync.syncDb(root);
  assert.equal(sync.getRecord(root, 7).external_id, 'm1');
  assert.equal(sync.listSignals(root, { status: 'all' })[0].kind, 'interview');
  const [page] = sync.upsertRecords(root, 1, [{ kind: 'page', external_id: 'posting:x', fields: {} }]);
  assert.ok(sync.addSignal(root, { record_id: page.id, kind: 'posting' }));
  sync.removeAccount(root, 1);
  assert.equal(sync.getRecord(root, 7), null, 'the cascade still runs after the rebuild');
  assert.equal(sync.listSignals(root, { status: 'all' }).length, 0);
});

// ---------------------------------------------------------------- over HTTP, from the extension's origin

test('the extension reaches /me and page.observe cross-origin with its key, and nothing else answers it', async () => {
  const { createServer } = await import('http');
  const { handleApi } = await import('../core/api.mjs');
  const { makeCtx } = await import('../core/http.mjs');
  const s = await setup();
  const { token } = issueToken(s.root, { actor: s.owner, userId: s.owner.id, kind: 'capture', name: 'chrome' });
  const server = createServer(async (req, res) => { if (!(await handleApi(req, res, makeCtx(req, res, { root: s.root })))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = 'chrome-extension://abcdefghijklmnop';
  try {
    const pre = await fetch(`${base}/api/v1/ops/page.observe`, { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);

    const me = await fetch(`${base}/api/v1/me`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    assert.equal(me.headers.get('access-control-allow-origin'), origin);
    assert.ok((await me.json()).result.token.scopes.includes('page.observe'));

    const seen = await fetch(`${base}/api/v1/ops/page.observe`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: POSTING }) });
    assert.equal(seen.headers.get('access-control-allow-origin'), origin);
    assert.equal((await seen.json()).result.wants_text, true);

    const other = await fetch(`${base}/api/v1/ops/inbox.list`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  } finally {
    server.close();
  }
});
