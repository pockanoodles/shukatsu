import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// A throwaway key, so no test touches the Keychain or the real key file.
process.env.SHUKATSU_SYNC_KEY = randomBytes(32).toString('base64');

const { run, sessionPrincipal, tokenPrincipal } = await import('../core/ops/index.mjs');
const { addBusySource } = await import('../core/ops/schedule.mjs');
const { acceptInvite, createAgent, createInvite, createSession, issueToken } = await import('../core/people.mjs');
const { addTrackerRow } = await import('../core/tracker.mjs');
const { makeCtx } = await import('../core/http.mjs');
const { recentActivity } = await import('../core/store.mjs');
const sync = await import('../core/sync.mjs');
const secrets = await import('../core/secrets.mjs');
const connectors = await import('../connectors/index.mjs');
const { makeConnectorCtx } = await import('../connectors/ctx.mjs');
const { occurrences, parseIcs, parseLine, unfold } = await import('../connectors/ics-in/parse.mjs');
const { busyTimes } = await import('../connectors/ics-in/index.mjs');
const { buildQueries, registrable, searchDomains } = await import('../connectors/gmail/query.mjs');
const gmail = await import('../connectors/gmail/index.mjs');
const { companyAliases, kindOf, signalFor } = await import('../connectors/signals.mjs');
const { makeRoot, people } = await import('./helpers.mjs');

const RECORDED = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'recorded');
const recorded = (name) => readFileSync(join(RECORDED, name), 'utf-8');

const FEED = 'webcal://canvas.example.edu/feeds/calendars/user_secret123token.ics';
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

/** A fake network: routes by URL, records every call, and answers like the real services did. */
function fakeNet(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [match, answer] of routes) {
      if (!String(url).includes(match)) continue;
      const out = typeof answer === 'function' ? answer(String(url), opts) : answer;
      if (out instanceof Error) throw out;
      return new Response(out.body, { status: out.status ?? 200, headers: { 'content-type': out.type || 'application/json' } });
    }
    throw new Error(`unexpected request to ${url}`);
  };
  return { fetch, calls };
}

const GMAIL_ROUTES = () => [
  ['oauth2.googleapis.com/token', { body: recorded('gmail-token.json') }],
  ['/messages/18f0a1', { body: recorded('gmail-message-18f0a1.json') }],
  ['/messages/18f0a2', { body: recorded('gmail-message-18f0a2.json') }],
  ['/gmail/v1/users/me/messages?', { body: recorded('gmail-messages-list.json') }],
];

async function setup() {
  const root = makeRoot();
  const cast = people(root);
  const viewerToken = createInvite(root, { actor: cast.owner, role: 'viewer', name: 'Dad' });
  const viewer = acceptInvite(root, viewerToken, { login: 'dad', password: 'a viewer password here' });
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code on the laptop' });
  const { token } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  const ownerP = sessionPrincipal(cast.owner);
  await connectors.boot(root, { addBusySource });
  return { root, ...cast, viewer, agent, ownerP, agentP: tokenPrincipal(root, token), editorP: sessionPrincipal(cast.editor), viewerP: sessionPrincipal(viewer) };
}

/** A tracker with two applications, written the canonical way (merge-tracker.mjs). */
function seedTracker(root) {
  const a = addTrackerRow(root, { company: 'Acme Robotics', role: 'Operations Analyst Intern', status: 'Applied', url: 'https://jobs.acmerobotics.com/roles/12' });
  const b = addTrackerRow(root, { company: 'Globex', role: 'Data Analyst Co-op', status: 'Applied', url: 'https://boards.greenhouse.io/globex/jobs/9' });
  assert.ok(a.ok && b.ok, `${a.out} ${b.out}`);
  return { acme: a.num, globex: b.num };
}

async function addFeed(s) {
  const { account } = await run(s.root, s.ownerP, 'connector.add', { connector: 'ics-in', label: 'Canvas', url: FEED, timezone: 'America/New_York' });
  return account;
}

async function addGmail(s) {
  const out = await run(s.root, s.ownerP, 'connector.add', { connector: 'gmail', label: 'Sam', client_id: 'client-123.apps.googleusercontent.com', client_secret: 'GOCSPX-super-secret-value' });
  return out;
}

// ---------------------------------------------------------------- the ICS parser

test('lines unfold, parameters keep their quoted colons, and text unescapes', () => {
  assert.deepEqual(unfold('A:one\r\n two\r\n\tthree\r\nB:x'), ['A:onetwothree', 'B:x']);
  const p = parseLine('ATTENDEE;CN="Lee; Dana: Recruiter";ROLE=REQ:mailto:dana@acme.example.com');
  assert.equal(p.name, 'ATTENDEE');
  assert.equal(p.params.CN, 'Lee; Dana: Recruiter');
  assert.equal(p.value, 'mailto:dana@acme.example.com');
});

test('the Canvas feed parses: folded and escaped text, all-day and zero-length due dates', () => {
  const { name, events, zones } = parseIcs(recorded('canvas.ics'));
  assert.match(name, /Sam Candidate Calendar/);
  assert.equal(events.length, 9);
  assert.equal(zones['America/New_York'], 'America/New_York');
  const lecture = events.find((e) => e.uid === 'event-calendar-event-101' && !e.recurrence_id);
  assert.equal(lecture.description, 'Room 210, Richards Hall.\nBring the laptop. This description is long enough that the feed folds it onto a second line.');
  assert.equal(lecture.rrule.FREQ, 'WEEKLY');
  assert.deepEqual(lecture.rrule.BYDAY, ['MO', 'WE']);
  assert.equal(lecture.exdates.length, 1);
  const allDay = events.find((e) => e.uid === 'event-assignment-555');
  const zero = events.find((e) => e.uid === 'event-assignment-556');
  assert.ok(allDay.deadline && zero.deadline);
  assert.ok(!events.find((e) => e.uid === 'event-calendar-event-102').deadline);
  assert.ok(events.find((e) => e.uid === 'event-calendar-event-105').cancelled);
});

test('a weekly class keeps its wall clock across daylight saving, honors EXDATE, UNTIL, and a moved session', () => {
  const { events, zones } = parseIcs(recorded('canvas.ics'));
  const occ = occurrences(events, { from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z', zones });
  const lecture = occ.filter((o) => o.uid === 'event-calendar-event-101');
  // 8 Mondays + Wednesdays 10-28, 11-4, 11-25, 12-2, 12-9 (11-11 is excluded, 12-16 is past UNTIL) + the moved 11-18.
  assert.equal(lecture.length, 14);
  const at = (iso) => lecture.find((o) => o.starts_at === iso);
  assert.ok(at('2026-10-26T14:00:00.000Z'), '10:00 EDT');
  assert.ok(at('2026-11-02T15:00:00.000Z'), '10:00 EST, the Monday after clocks fell back');
  assert.ok(!lecture.some((o) => o.starts_at.startsWith('2026-11-11')), 'EXDATE');
  assert.ok(!lecture.some((o) => o.starts_at.startsWith('2026-12-16')), 'UNTIL');
  assert.ok(!at('2026-11-18T15:00:00.000Z'), 'the original 11-18 session is replaced');
  const moved = at('2026-11-18T19:00:00.000Z');
  assert.equal(moved.summary, 'CS 3000 Lecture (moved)');
  assert.equal(moved.ends_at, '2026-11-18T20:15:00.000Z');
});

test('COUNT and DAILY, DURATION, a UTC time, and a cancelled event', () => {
  const { events, zones } = parseIcs(recorded('canvas.ics'));
  const occ = occurrences(events, { from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z', zones });
  const prep = occ.filter((o) => o.uid === 'event-calendar-event-104').map((o) => o.starts_at);
  // Noon Eastern: EDT on the 30th and 31st, EST on November 1st.
  assert.deepEqual(prep, ['2026-10-30T16:00:00.000Z', '2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z']);
  const hours = occ.find((o) => o.uid === 'event-calendar-event-103');
  assert.equal(hours.starts_at, '2026-10-27T19:00:00.000Z');
  assert.equal(hours.ends_at, '2026-10-27T19:45:00.000Z');
  assert.ok(!occ.some((o) => o.uid === 'event-calendar-event-105'), 'STATUS:CANCELLED');
});

test('due dates and all-day spans come back as dates, not instants', () => {
  const { events, zones } = parseIcs(recorded('canvas.ics'));
  const occ = occurrences(events, { from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z', zones });
  const ps = occ.find((o) => o.uid === 'event-assignment-555');
  assert.deepEqual([ps.all_day, ps.starts_at, ps.ends_at, ps.deadline], [true, '2026-10-30', '2026-10-30', true]);
  const lab = occ.find((o) => o.uid === 'event-assignment-556');
  assert.deepEqual([lab.all_day, lab.starts_at, lab.ends_at, lab.deadline], [false, '2026-10-30T03:59:00.000Z', null, true]);
  const reading = occ.find((o) => o.uid === 'event-calendar-event-106');
  assert.deepEqual([reading.starts_at, reading.ends_at, reading.deadline], ['2026-12-14', '2026-12-16', false]);
  const midterm = occ.find((o) => o.uid === 'event-calendar-event-102');
  assert.deepEqual([midterm.starts_at, midterm.ends_at], ['2026-11-05T23:00:00.000Z', '2026-11-06T01:00:00.000Z']);
});

test('only what touches the window comes back', () => {
  const { events, zones } = parseIcs(recorded('canvas.ics'));
  const occ = occurrences(events, { from: '2026-10-26T00:00:00Z', until: '2026-10-28T23:59:00Z', zones });
  assert.deepEqual(occ.filter((o) => o.uid === 'event-calendar-event-101').map((o) => o.starts_at), ['2026-10-26T14:00:00.000Z', '2026-10-28T14:00:00.000Z']);
});

test('Windows zone names and floating times read in the given default zone', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:w1', 'SUMMARY:Windows zone', 'DTSTART;TZID=Eastern Standard Time:20260715T090000', 'DTEND;TZID=Eastern Standard Time:20260715T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:f1', 'SUMMARY:Floating', 'DTSTART:20260715T090000', 'DTEND:20260715T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:m1', 'SUMMARY:Monthly review', 'DTSTART;TZID=Asia/Tokyo:20260601T150000', 'DTEND;TZID=Asia/Tokyo:20260601T160000', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const { events, zones } = parseIcs(ics);
  const occ = occurrences(events, { from: '2026-06-01T00:00:00Z', until: '2026-09-01T00:00:00Z', zones, defaultZone: 'America/Chicago' });
  assert.equal(occ.find((o) => o.uid === 'w1').starts_at, '2026-07-15T13:00:00.000Z', 'July is EDT, so 9:00 Eastern is 13:00Z');
  assert.equal(occ.find((o) => o.uid === 'f1').starts_at, '2026-07-15T14:00:00.000Z', 'a floating time is Central here');
  assert.deepEqual(occ.filter((o) => o.uid === 'm1').map((o) => o.starts_at), ['2026-06-01T06:00:00.000Z', '2026-07-06T06:00:00.000Z', '2026-08-03T06:00:00.000Z']);
});

// ---------------------------------------------------------------- the calendar feed end to end

test('a feed syncs through the connector, feeds calendar.conflicts as busy time, and lists due dates separately', async () => {
  const s = await setup();
  const account = await addFeed(s);
  const net = fakeNet([['canvas.example.edu', { body: recorded('canvas.ics'), type: 'text/calendar' }]]);
  const out = await connectors.syncNow(s.root, account.id, { fetch: net.fetch });
  assert.deepEqual([out.ok, out.records, out.added], [true, 9, 9]);
  assert.equal(net.calls[0].url, 'https://canvas.example.edu/feeds/calendars/user_secret123token.ics', 'webcal:// is fetched as https://');

  // Monday 2 Nov, 10:30 Eastern, is inside the 10:00 lecture. 1 pm that day is free.
  const busy = await run(s.root, s.agentP, 'calendar.conflicts', { start: '2026-11-02T10:30', end: '2026-11-02T11:00', timezone: 'America/New_York', gap_minutes: 0 });
  assert.equal(busy.clear, false);
  assert.equal(busy.conflicts[0].event.title, 'CS 3000 Lecture');
  assert.match(busy.conflicts[0].event.source, /^ics-in:Canvas/);
  const free = await run(s.root, s.agentP, 'calendar.conflicts', { start: '2026-11-02T13:00', end: '2026-11-02T14:00', timezone: 'America/New_York', gap_minutes: 0 });
  assert.equal(free.clear, true);
  // The night before the midterm is clear; the midterm itself conflicts.
  const exam = await run(s.root, s.agentP, 'calendar.conflicts', { start: '2026-11-05T18:30', end: '2026-11-05T19:00', timezone: 'America/New_York', gap_minutes: 0 });
  assert.equal(exam.clear, false);

  // Due dates are in the busy list, marked as deadlines so a caller can report "due that day".
  const items = busyTimes(s.root, { from: '2026-10-29T00:00:00Z', until: '2026-10-31T23:59:59Z' });
  const due = items.filter((i) => i.kind === 'deadline').map((i) => i.title).sort();
  assert.deepEqual(due, ['Lab Report 2 [PHYS 1151]', 'Problem Set 4 [CS 3000]']);
  assert.ok(items.some((i) => i.title === 'Career fair prep' && i.kind === 'busy'));
});

test('a feed that loses an event drops it on the next sync', async () => {
  const s = await setup();
  const account = await addFeed(s);
  await connectors.syncNow(s.root, account.id, { fetch: fakeNet([['canvas.example.edu', { body: recorded('canvas.ics') }]]).fetch });
  const trimmed = recorded('canvas.ics').replace(/BEGIN:VEVENT\r\nUID:event-calendar-event-106[\s\S]*?END:VEVENT\r\n/, '');
  const out = await connectors.syncNow(s.root, account.id, { fetch: fakeNet([['canvas.example.edu', { body: trimmed }]]).fetch });
  assert.equal(out.records, 8);
  assert.equal(sync.listRecords(s.root, { accountId: account.id }).length, 8);
});

test('egress is pinned to the connector\'s hosts and logged without the feed address', async () => {
  const s = await setup();
  const account = await addFeed(s);
  const net = fakeNet([['canvas.example.edu', { body: recorded('canvas.ics') }], ['evil.example.com', { body: 'x' }]]);
  await connectors.syncNow(s.root, account.id, { fetch: net.fetch });
  const lines = readFileSync(join(s.root, '.shukatsu', 'egress.log'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].actor, lines[0].connector, lines[0].purpose, lines[0].host, lines[0].status], ['connector', 'ics-in', 'feed', 'canvas.example.edu', 200]);
  assert.ok(!JSON.stringify(lines).includes('secret123token'), 'no feed address in the log');
  assert.ok(!JSON.stringify(lines).includes('BEGIN:VCALENDAR'), 'no body in the log');

  const ctx = makeConnectorCtx(s.root, connectors.manifestFor('ics-in'), sync.getAccount(s.root, account.id), { fetch: net.fetch });
  await assert.rejects(ctx.fetch('https://evil.example.com/steal'), /not in allowedHosts/);
  await assert.rejects(ctx.fetch('http://canvas.example.edu/plain'), /HTTPS/);
  assert.equal(net.calls.filter((c) => c.url.includes('evil')).length, 0, 'a refused host is never contacted');

  const gm = connectors.manifestFor('gmail');
  assert.deepEqual([...gm.allowedHosts].sort(), ['gmail.googleapis.com', 'oauth2.googleapis.com']);
});

// ---------------------------------------------------------------- gmail: query, sign-in, sync

test('the Gmail query is built from ATS senders, school platforms, tracker and campaign domains, and subject words', async () => {
  const s = await setup();
  seedTracker(s.root);
  await run(s.root, s.agentP, 'campaign.create', { name: 'Example Career Forum', kind: 'fair', url: 'https://fair.example.org/2026' });
  const domains = searchDomains(s.root, ['extra-employer.com']);
  for (const d of ['symplicity.com', 'joinhandshake.com', 'careerforum.net', 'greenhouse.io', 'lever.co', 'myworkday.com', 'acmerobotics.com', 'example.org', 'extra-employer.com']) {
    assert.ok(domains.includes(d), `${d} is searched`);
  }
  assert.ok(domains.includes('jobs-noreply@linkedin.com') && !domains.includes('linkedin.com'), 'LinkedIn is searched by its application and message senders only');
  assert.ok(!domains.some((d) => d.startsWith('jobs.')), 'a company is searched by its domain, not a careers subdomain');

  const [q] = buildQueries({ domains: ['acme.com', 'globex.org'], days: 7 });
  assert.equal(q, '(from:(acme.com OR globex.org) OR subject:(interview OR assessment OR application OR offer OR 面接 OR 選考 OR 内定 OR エントリー)) newer_than:7d');
  assert.equal(registrable('careers.acme.co.jp'), 'acme.co.jp');
  assert.equal(registrable('www.acme.com'), 'acme.com');
});

test('a long domain list splits into several queries, each within the limit, with subject words once', () => {
  const domains = Array.from({ length: 200 }, (_, i) => `company-number-${i}.example.com`);
  const queries = buildQueries({ domains, days: 3, maxLength: 800 });
  assert.ok(queries.length > 1);
  for (const q of queries) { assert.ok(q.length <= 800, `${q.length}`); assert.match(q, /newer_than:3d$/); }
  assert.equal(queries.filter((q) => q.includes('subject:(')).length, 1);
  const seen = new Set(queries.flatMap((q) => [...q.matchAll(/company-number-\d+\.example\.com/g)].map((m) => m[0])));
  assert.equal(seen.size, 200, 'every domain is in some query');
});

test('Google sign-in: PKCE start, state check, refresh token kept encrypted', async () => {
  const s = await setup();
  const { account, next } = await addGmail(s);
  assert.equal(account.status, 'needs_auth');
  assert.equal(next, `/connectors/gmail/start?account=${account.id}`);

  const redirectUri = 'https://shukatsu.example.net/connectors/gmail/callback';
  const url = new URL(gmail.beginAuth(s.root, account.id, redirectUri));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(url.searchParams);
  assert.deepEqual([q.access_type, q.prompt, q.scope, q.response_type, q.code_challenge_method, q.redirect_uri], ['offline', 'consent', 'https://www.googleapis.com/auth/gmail.readonly', 'code', 'S256', redirectUri]);
  assert.ok(q.code_challenge.length >= 40 && q.state.length >= 20);

  const net = fakeNet([['oauth2.googleapis.com/token', { body: recorded('gmail-token.json') }]]);
  const accounts = sync.listAccounts(s.root, { connector: 'gmail' });
  await assert.rejects(gmail.completeAuth(s.root, { state: 'wrong-state', code: 'abc', redirectUri, accounts, fetch: net.fetch }), /not started here/);
  assert.equal(net.calls.length, 0, 'a wrong state never reaches Google');
  await gmail.completeAuth(s.root, { state: q.state, code: 'auth-code-1', redirectUri, accounts, fetch: net.fetch });
  const body = new URLSearchParams(net.calls[0].opts.body);
  assert.deepEqual([body.get('grant_type'), body.get('code'), body.get('redirect_uri')], ['authorization_code', 'auth-code-1', redirectUri]);
  assert.ok(body.get('code_verifier').length >= 43, 'PKCE verifier is sent');
  assert.equal(sync.getSecret(s.root, account.id).refresh_token, '1//recorded-refresh-token');
  assert.equal(sync.getAccount(s.root, account.id).status, 'ok');
  assert.equal(sync.getSecret(s.root, account.id).pending, undefined);
});

async function signedInGmail(s) {
  const { account } = await addGmail(s);
  sync.setSecret(s.root, account.id, { client_secret: 'GOCSPX-super-secret-value', refresh_token: '1//recorded-refresh-token' });
  sync.updateAccount(s.root, account.id, { status: 'ok' });
  return account;
}

test('Gmail syncs by search, fetches only messages it does not hold, and stores them as records', async () => {
  const s = await setup();
  const acct = await signedInGmail(s);
  const net = fakeNet(GMAIL_ROUTES());
  const out = await connectors.syncNow(s.root, acct.id, { fetch: net.fetch });
  assert.deepEqual([out.ok, out.added], [true, 2], out.error);

  const list = net.calls.find((c) => c.url.includes('/messages?'));
  const q = new URL(list.url).searchParams.get('q');
  assert.match(q, /newer_than:60d/);
  assert.match(q, /subject:\(interview OR/);
  assert.match(q, /greenhouse\.io/);
  assert.equal(list.opts.headers.authorization, 'Bearer ya29.recorded-access-token');

  const [first] = sync.listRecords(s.root, { accountId: acct.id }).filter((r) => r.external_id === '18f0a1');
  assert.equal(first.kind, 'message');
  assert.equal(first.fields.subject, 'Interview invitation: Operations Analyst Intern');
  assert.equal(first.fields.from, 'Dana Reyes <recruiting@acme.example.com>');
  assert.equal(first.fields.thread, 't-acme');
  assert.ok(first.fields.links.includes('https://acme.example.com/schedule/abc123'));
  assert.match(first.text, /would like to invite you to interview/);

  // The next run asks again but fetches nothing it already holds, and the window narrows to the cursor.
  const again = fakeNet(GMAIL_ROUTES());
  const out2 = await connectors.syncNow(s.root, acct.id, { fetch: again.fetch });
  assert.equal(out2.added, 0);
  assert.equal(again.calls.filter((c) => /\/messages\/18f/.test(c.url)).length, 0);
  assert.match(new URL(again.calls.find((c) => c.url.includes('/messages?')).url).searchParams.get('q'), /newer_than:2d/);

  // The audit log names hosts and purposes, never a token or a message.
  const log = readFileSync(join(s.root, '.shukatsu', 'egress.log'), 'utf-8');
  assert.ok(!log.includes('ya29') && !log.includes('recorded-refresh-token') && !log.includes('GOCSPX') && !log.includes('Operations Analyst'));
  const hosts = new Set(log.trim().split('\n').map((l) => JSON.parse(l).host));
  assert.deepEqual([...hosts].sort(), ['gmail.googleapis.com', 'oauth2.googleapis.com']);
});

test('a revoked Gmail sign-in is reported as needing sign-in, with the 7 day Testing mode hint', async () => {
  const s = await setup();
  const acct = await signedInGmail(s);
  gmail.forgetTokens();
  const dead = Object.assign(new Error('HTTP 400: {"error":"invalid_grant","error_description":"Token has been expired or revoked."}'), { status: 400 });
  const out = await connectors.syncNow(s.root, acct.id, { fetch: fakeNet([['oauth2.googleapis.com/token', dead]]).fetch });
  assert.equal(out.ok, false);
  assert.match(out.error, /Testing mode/);
  const a = sync.getAccount(s.root, acct.id);
  assert.equal(a.status, 'needs_auth');
  assert.ok(a.last_error);
  // Due-sync leaves an account that needs sign-in alone.
  assert.deepEqual(await connectors.syncDue(s.root, { fetch: fakeNet([]).fetch, nowMs: Date.now() + 86_400_000 }), []);
});

// ---------------------------------------------------------------- signals

test('classification: an invitation that opens with "thank you for applying" is still an invitation', () => {
  const k = (subject, text, from = 'x@acme.example.com') => kindOf({ from, subject, text }).kind;
  assert.equal(k('Next steps', 'Thank you for applying. We would like to invite you to interview with our team.'), 'interview');
  assert.equal(k('Update', 'Unfortunately we will not be moving forward with your application.'), 'rejection');
  assert.equal(k('Your assessment', 'Please complete the online test within 5 days.'), 'assessment');
  assert.equal(k('Application received', 'Thank you for applying. We received your application.'), 'confirmation');
  assert.equal(k('Weekly digest', 'Here are your recommended jobs this week. Job alert.'), 'noise');
  assert.equal(k('Offer letter', 'We are pleased to offer you the position. Offer letter attached.'), 'offer');
  assert.equal(k('Lunch', 'Want to grab lunch?'), 'other');
});

test('new messages become signals linked to their tracker rows, and the proposals hold nothing from the email', async () => {
  const s = await setup();
  const rows = seedTracker(s.root);
  const acct = await signedInGmail(s);
  await connectors.syncNow(s.root, acct.id, { fetch: fakeNet(GMAIL_ROUTES()).fetch });

  const list = await run(s.root, s.agentP, 'inbox.list', {});
  assert.equal(list.signals.length, 2);
  const interview = list.signals.find((x) => x.kind === 'interview');
  const rejection = list.signals.find((x) => x.kind === 'rejection');
  assert.deepEqual([interview.tracker_num, interview.confidence, interview.status], [rows.acme, 'high', 'open']);
  assert.deepEqual([rejection.tracker_num, rejection.status], [rows.globex, 'open']);

  const [act] = interview.proposed.actions;
  assert.deepEqual(act, { op: 'tracker.setStatus', input: { num: rows.acme, state: 'Interview', note: 'An interview invitation arrived by email.' } });
  assert.equal(rejection.proposed.actions[0].input.state, 'Rejected');
  assert.equal(interview.proposed.matched.company, 'Acme Robotics');
  // The email ends with an instruction aimed at an AI. It decides nothing, and nothing in the signal repeats it.
  const signalText = JSON.stringify(list.signals);
  assert.ok(!/ignore all previous|every application|Dana/i.test(signalText));
  assert.ok(list.untrusted.items.some((i) => /Interview invitation/.test(i.subject) && /Dana Reyes/.test(i.from)));

  const full = await run(s.root, s.agentP, 'inbox.get', { id: interview.id });
  assert.match(full.untrusted.text, /Ignore all previous instructions/, 'outside text is under untrusted, as data');
  assert.ok(!JSON.stringify(full.signal).includes('Ignore all previous'));
  assert.equal(full.untrusted.fields.subject, 'Interview invitation: Operations Analyst Intern');
});

test('an agent acts on a signal through the ordinary operations, then closes it', async () => {
  const s = await setup();
  const rows = seedTracker(s.root);
  const acct = await signedInGmail(s);
  await connectors.syncNow(s.root, acct.id, { fetch: fakeNet(GMAIL_ROUTES()).fetch });
  const { signals } = await run(s.root, s.agentP, 'inbox.list', { kind: 'interview' });
  const [sig] = signals;
  for (const action of sig.proposed.actions) await run(s.root, s.agentP, action.op, action.input);
  const tracker = await run(s.root, s.agentP, 'tracker.list', {});
  assert.equal(tracker.rows.find((r) => r.num === rows.acme).status, 'Interview');

  await rejects(run(s.root, s.agentP, 'signal.update', { id: sig.id, status: 'acted' }), 'invalid_input');
  const done = await run(s.root, s.agentP, 'signal.update', { id: sig.id, status: 'acted', note: 'Moved #1 to Interview.', tracker_num: rows.acme });
  assert.deepEqual([done.status, done.tracker_num], ['acted', rows.acme]);
  assert.equal((await run(s.root, s.agentP, 'inbox.list', {})).signals.length, 1, 'the closed one leaves the open list');
  assert.equal((await run(s.root, s.agentP, 'inbox.list', { status: 'acted' })).signals.length, 1);
  const log = recentActivity(s.root, { limit: 20 });
  assert.ok(log.some((a) => a.verb === 'signal.updated' && a.actor_id === s.agent.id), 'the agent\'s close is in the activity log under its name');
});

test('a stale or ambiguous message proposes nothing, and noise closes itself', () => {
  const rows = [
    { num: 1, company: 'Acme Robotics', role: 'Operations Analyst Intern', status: 'Rejected', date: '2026-09-01', notes: '' },
    { num: 2, company: 'Globex', role: 'Data Analyst', status: 'Applied', date: '2026-09-01', notes: '' },
  ];
  const rec = (fields, text) => ({ id: 1, external_id: 'x', kind: 'message', connector: 'gmail', fields: { links: [], ...fields }, text });
  // Already Rejected: a second invitation from Acme is not a step forward.
  const stale = signalFor(rec({ from: 'hr@acme.example.com', subject: 'Interview with Acme Robotics' }, 'Acme Robotics would like to invite you to interview.'), { rows });
  assert.equal(stale.kind, 'interview');
  assert.deepEqual(stale.proposed.actions, []);
  const noise = signalFor(rec({ from: 'jobs@board.example.com', subject: 'Recommended jobs' }, 'Job alert: recommended jobs for you'), { rows });
  assert.deepEqual([noise.kind, noise.status], ['noise', 'dismissed']);
  const unknown = signalFor(rec({ from: 'someone@nowhere.example.com', subject: 'Interview invitation' }, 'We would like to invite you to interview with us.'), { rows });
  assert.deepEqual([unknown.kind, unknown.tracker_num, unknown.confidence, unknown.status], ['interview', null, 'low', 'open']);
});

const mail = (fields, text) => ({ id: 1, external_id: 'x', kind: 'message', connector: 'gmail', fields: { links: [], ...fields }, text });
const OIINORI = '選考の結果、誠に残念ながら今回はご期待に沿えない結果となりました。今後のご活躍をお祈り申し上げます。';

test('classification: Japanese mail by its set phrases, and moving an interview is not a rejection', () => {
  const k = (subject, text, from = 'saiyo@globex.example.co.jp') => kindOf({ from, subject, text }).kind;
  assert.equal(k('【選考結果のご連絡】', OIINORI), 'rejection');
  assert.equal(k('【面接のご案内】', '書類選考の結果、面接にお進みいただきたくご連絡いたしました。'), 'interview');
  assert.equal(k('内定のご連絡', 'このたび内定をお出しすることになりました。'), 'offer');
  assert.notEqual(k('内定者座談会のご案内', '内定者との座談会を開催します。'), 'offer', 'an event for 内定者 is not an offer');
  assert.equal(k('Webテストのご案内', 'Webテストを受検してください。'), 'assessment');
  assert.equal(k('エントリー受付のお知らせ', 'エントリーを受け付けました。'), 'confirmation');
  assert.equal(k('今週のおすすめ求人', '最終面接で差がつく逆質問。配信停止はこちら。', 'news@mynavi.jp'), 'noise', 'a board\'s newsletter, interview talk and all');
  assert.equal(k('Change to your interview', 'Unfortunately, we need to reschedule your interview. Please pick a new time.', 'x@acme.example.com'), 'interview');
});

test('one company\'s rows: its own name in a title counts for nothing, a word only one role has decides, and news after sending goes to the one sent', () => {
  const rows = [
    { num: 1, company: 'Initech', role: '2027 Initech Field Service Summer Internship', status: 'Evaluated', date: '2026-10-01', notes: '', via: 'CFN' },
    { num: 2, company: 'Initech', role: 'Market Research and Strategy Associate (2028 Entry)', status: 'Applied', date: '2026-10-01', notes: '', via: 'CFN' },
  ];
  const from = 'Initech Recruiting <recruiting@initech.example.com>';
  const named = signalFor(mail({ from, subject: 'Your application: Research & Strategy' }, 'Thank you for your interest in the Research & Strategy role at Initech. Unfortunately, we have decided not to move forward with your application.'), { rows });
  assert.deepEqual([named.kind, named.tracker_num], ['rejection', 2]);
  const generic = 'After careful consideration, we regret to inform you that we will not be moving forward with your candidacy.';
  const sent = signalFor(mail({ from, subject: 'Your application to Initech' }, generic), { rows });
  assert.deepEqual([sent.tracker_num, sent.confidence, sent.proposed.actions[0].input.state], [2, 'medium', 'Rejected']);
  // Both sent, and nothing in the message tells them apart: no row, and both listed for the candidate to pick.
  const unsure = signalFor(mail({ from, subject: 'Your application to Initech' }, generic), { rows: rows.map((r) => ({ ...r, status: 'Applied' })) });
  assert.deepEqual([unsure.tracker_num, unsure.proposed.actions, unsure.proposed.choices], [null, [], [1, 2]]);
});

test('a board\'s mail speaks only for the rows that went through that board', () => {
  const rows = [
    { num: 1, company: 'Initech', role: 'Operations Analyst', status: 'Applied', date: '2026-10-01', notes: 'applied on https://initech.wd1.myworkdayjobs.com/en-US/careers/job/123', via: '' },
    { num: 2, company: 'Globex', role: 'Data Analyst', status: 'Applied', date: '2026-10-01', notes: '', via: 'Handshake' },
  ];
  const from = 'Handshake <noreply@joinhandshake.com>';
  const news = signalFor(mail({ from, subject: 'Initech wants to interview students like you' }, 'Initech is inviting students to interview. We would like to invite you to apply on Handshake.'), { rows });
  assert.deepEqual([news.kind, news.tracker_num, news.status], ['other', null, 'dismissed']);
  const own = signalFor(mail({ from, subject: 'Globex invited you to interview' }, 'Globex would like to invite you to interview for the Data Analyst role.'), { rows });
  assert.deepEqual([own.kind, own.tracker_num, own.proposed.actions[0].input.state], ['interview', 2, 'Interview']);
});

test('mail in Japanese finds its row by the company\'s Japanese name in targets.yml', () => {
  const root = mkdtempSync(join(tmpdir(), 'shukatsu-aka-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'targets.yml'), 'companies:\n  - name: "Globex Securities Group"\n    ja: [グローベックス証券]\n  - name: "Initech"\n');
  const rows = [
    { num: 1, company: 'Globex Securities', role: 'リサーチ・アナリスト Research Analyst internship', status: 'Applied', date: '2026-08-03', notes: '', via: 'CFN' },
    { num: 2, company: 'Initech', role: 'Analyst', status: 'Applied', date: '2026-08-03', notes: '', via: 'CFN' },
  ];
  const aliases = companyAliases(root, rows);
  assert.deepEqual([...aliases], [['Globex Securities', ['グローベックス証券']]]);
  const from = 'CareerForum.Net <info@careerforum.net>';
  const no = signalFor(mail({ from, subject: '【選考結果のご連絡】グローベックス証券' }, OIINORI), { rows, aliases });
  assert.deepEqual([no.kind, no.tracker_num, no.proposed.actions[0].input.state], ['rejection', 1, 'Rejected']);
  const yes = signalFor(mail({ from, subject: '【面接のご案内】グローベックス証券' }, '書類選考の結果、面接にお進みいただきたくご連絡いたしました。'), { rows, aliases });
  assert.deepEqual([yes.kind, yes.tracker_num], ['interview', 1]);
  rmSync(root, { recursive: true, force: true });
});

test('a calendar event about an interview becomes a medium-confidence signal; other events make none', () => {
  const rows = [{ num: 3, company: 'Initech', role: 'Analyst', status: 'Applied', date: '2026-09-01', notes: '' }];
  const ev = (summary) => ({ id: 5, external_id: 'e', kind: 'event', connector: 'ics-in', fields: { summary }, text: summary });
  assert.equal(signalFor(ev('Lecture'), { rows }), null);
  const s = signalFor(ev('Initech interview - Analyst'), { rows });
  assert.deepEqual([s.kind, s.tracker_num, s.confidence], ['interview', 3, 'medium']);
});

// ---------------------------------------------------------------- operations: permissions and secrets

test('who may list the inbox and the connectors, and who may not', async () => {
  const s = await setup();
  await addFeed(s);
  await run(s.root, s.agentP, 'inbox.list', {});
  await run(s.root, s.ownerP, 'inbox.list', {});
  await run(s.root, s.agentP, 'connector.list', {});
  for (const p of [s.viewerP, s.editorP]) {
    await rejects(run(s.root, p, 'inbox.list', {}), 'denied');
    await rejects(run(s.root, p, 'inbox.get', { id: 1 }), 'denied');
    await rejects(run(s.root, p, 'connector.list', {}), 'denied');
    await rejects(run(s.root, p, 'signal.update', { id: 1, status: 'dismissed' }), 'denied');
    await rejects(run(s.root, p, 'connector.sync', { id: 1 }), 'denied');
  }
  await rejects(run(s.root, s.agentP, 'inbox.get', { id: 999 }), 'not_found');
});

test('connector.add, update, remove, and purge are stamps: refused for an agent, allowed for the owner in the app', async () => {
  const s = await setup();
  const account = await addFeed(s);
  const input = { connector: 'ics-in', url: FEED };
  await rejects(run(s.root, s.agentP, 'connector.add', input), 'stamp_required');
  await rejects(run(s.root, s.agentP, 'connector.update', { id: account.id, label: 'x' }), 'stamp_required');
  await rejects(run(s.root, s.agentP, 'connector.remove', { id: account.id }), 'stamp_required');
  await rejects(run(s.root, s.agentP, 'connector.purge', {}), 'stamp_required');
  await rejects(run(s.root, s.editorP, 'connector.add', input), 'stamp_required');
  const renamed = await run(s.root, s.ownerP, 'connector.update', { id: account.id, label: 'Canvas (NU)' });
  assert.equal(renamed.account.label, 'Canvas (NU)');
  const paused = await run(s.root, s.ownerP, 'connector.update', { id: account.id, paused: true });
  assert.equal(paused.account.status, 'paused');
  await rejects(run(s.root, s.ownerP, 'connector.add', { connector: 'ics-in', url: 'not a url' }), 'invalid_input');
  await rejects(run(s.root, s.ownerP, 'connector.add', { connector: 'gmail', client_id: 'only-an-id' }), 'invalid_input');
  await rejects(run(s.root, s.ownerP, 'connector.add', { connector: 'ics-in', url: FEED, surprise: 1 }), 'invalid_input');
  await rejects(run(s.root, s.ownerP, 'connector.add', { connector: 'slack', url: FEED }), 'invalid_input');
  await rejects(run(s.root, s.ownerP, 'connector.remove', { id: 9999 }), 'not_found');
});

test('listing never returns a credential, and sync.db holds none in the clear', async () => {
  const s = await setup();
  await addFeed(s);
  const { account } = await addGmail(s);
  sync.setSecret(s.root, account.id, { client_secret: 'GOCSPX-super-secret-value', refresh_token: '1//recorded-refresh-token' });
  const list = await run(s.root, s.agentP, 'connector.list', {});
  const text = JSON.stringify(list);
  for (const secret of ['secret123token', '/feeds/calendars', 'GOCSPX', 'recorded-refresh-token']) assert.ok(!text.includes(secret), secret);
  const feed = list.accounts.find((a) => a.connector === 'ics-in');
  assert.deepEqual([feed.settings.host, feed.has_secret], ['canvas.example.edu', true]);
  assert.equal(list.accounts.find((a) => a.connector === 'gmail').settings.client_id, 'client-123.apps.googleusercontent.com');

  sync.syncDb(s.root).exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const files = ['sync.db', 'sync.db-wal'].map((f) => join(s.root, '.shukatsu', f)).filter(existsSync);
  for (const f of files) {
    const bytes = readFileSync(f).toString('latin1');
    for (const secret of ['secret123token', 'GOCSPX-super-secret-value', '1//recorded-refresh-token']) assert.ok(!bytes.includes(secret), `${secret} in ${f}`);
  }
});

test('a failing sync records last_error without the credential, and backs off', async () => {
  const s = await setup();
  const account = await addFeed(s);
  const bad = Object.assign(new Error('connect failed for https://canvas.example.edu/feeds/calendars/user_secret123token.ics'), { status: 502 });
  const results = await connectors.syncDue(s.root, { fetch: fakeNet([['canvas.example.edu', bad]]).fetch });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  const a = sync.getAccount(s.root, account.id);
  assert.equal(a.status, 'error');
  assert.equal(a.fail_count, 1);
  assert.ok(a.last_error && !a.last_error.includes('secret123token'), a.last_error);
  const list = await run(s.root, s.agentP, 'connector.list', {});
  assert.equal(list.accounts[0].has_error, true);
  assert.ok(list.untrusted.errors[String(account.id)], 'the error text is outside text');
  // Just failed, so not due again for two intervals.
  assert.deepEqual(await connectors.syncDue(s.root, { fetch: fakeNet([]).fetch }), []);
  // After the backoff it runs, and success clears the error.
  const later = await connectors.syncDue(s.root, { fetch: fakeNet([['canvas.example.edu', { body: recorded('canvas.ics') }]]).fetch, nowMs: Date.now() + 3 * 3_600_000 });
  assert.equal(later[0].ok, true);
  assert.deepEqual([sync.getAccount(s.root, account.id).status, sync.getAccount(s.root, account.id).last_error], ['ok', null]);
});

test('syncDue never throws, even when the data under it is gone', async () => {
  const s = await setup();
  await addFeed(s);
  sync.destroy(s.root);
  const out = await connectors.syncDue(s.root, { fetch: fakeNet([]).fetch });
  assert.ok(Array.isArray(out));
});

test('secrets round-trip, refuse tampering and another key, and the key file is private', () => {
  const blob = secrets.encrypt({ refresh_token: 'abc', n: 1 });
  assert.match(blob, /^v1\./);
  assert.ok(!blob.includes('abc'));
  assert.deepEqual(secrets.decryptJson(blob), { refresh_token: 'abc', n: 1 });
  assert.notEqual(secrets.encrypt('same'), secrets.encrypt('same'), 'a fresh nonce each time');
  const parts = blob.split('.');
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  assert.throws(() => secrets.decrypt(parts.join('.')));
  assert.throws(() => secrets.decrypt('garbage'));

  const saved = { key: process.env.SHUKATSU_SYNC_KEY, file: process.env.SHUKATSU_SYNC_KEY_FILE };
  try {
    delete process.env.SHUKATSU_SYNC_KEY;
    process.env.SHUKATSU_SYNC_KEY_FILE = join(mkdtempSync(join(tmpdir(), 'shukatsu-key-')), 'nested', 'sync.key');
    secrets.forgetKey();
    const viaFile = secrets.encrypt('from the key file');
    assert.equal(statSync(process.env.SHUKATSU_SYNC_KEY_FILE).mode & 0o777, 0o600);
    secrets.forgetKey();
    assert.equal(secrets.decrypt(viaFile), 'from the key file', 'the same file gives the same key');
    process.env.SHUKATSU_SYNC_KEY = randomBytes(32).toString('base64');
    secrets.forgetKey();
    assert.throws(() => secrets.decrypt(viaFile), 'another key cannot read it');
  } finally {
    process.env.SHUKATSU_SYNC_KEY = saved.key;
    if (saved.file === undefined) delete process.env.SHUKATSU_SYNC_KEY_FILE; else process.env.SHUKATSU_SYNC_KEY_FILE = saved.file;
    secrets.forgetKey();
  }
  assert.throws(() => { process.env.SHUKATSU_SYNC_KEY = 'short'; secrets.forgetKey(); secrets.encrypt('x'); }, /32 bytes/);
  process.env.SHUKATSU_SYNC_KEY = saved.key;
  secrets.forgetKey();
});

// ---------------------------------------------------------------- purge

test('purge deletes the copies by connector or entirely, leaves accounts, and removing an account deletes everything of it', async () => {
  const s = await setup();
  seedTracker(s.root);
  const feed = await addFeed(s);
  const gm = await signedInGmail(s);
  await connectors.syncNow(s.root, feed.id, { fetch: fakeNet([['canvas.example.edu', { body: recorded('canvas.ics') }]]).fetch });
  await connectors.syncNow(s.root, gm.id, { fetch: fakeNet(GMAIL_ROUTES()).fetch });
  assert.equal(sync.listRecords(s.root, {}).length, 11);
  assert.equal((await run(s.root, s.agentP, 'inbox.list', { status: 'all' })).signals.length, 2);

  const one = await run(s.root, s.ownerP, 'connector.purge', { connector: 'gmail' });
  assert.deepEqual(one, { records: 2, signals: 2 });
  assert.equal(sync.listRecords(s.root, { connector: 'gmail' }).length, 0);
  assert.equal(sync.listRecords(s.root, { connector: 'ics-in' }).length, 9, 'the other connector is untouched');
  assert.equal(sync.getAccount(s.root, gm.id).last_sync_at, null);
  assert.equal(sync.getCursor(s.root, gm.id), null);
  assert.equal((await run(s.root, s.agentP, 'inbox.list', { status: 'all' })).signals.length, 0);

  const all = await run(s.root, s.ownerP, 'connector.purge', {});
  assert.equal(all.records, 9);
  assert.equal(sync.listRecords(s.root, {}).length, 0);
  assert.equal(sync.listAccounts(s.root).length, 2, 'accounts stay connected');
  assert.equal(busyTimes(s.root, { from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z' }).length, 0, 'purged feeds are no longer busy time');

  await connectors.syncNow(s.root, feed.id, { fetch: fakeNet([['canvas.example.edu', { body: recorded('canvas.ics') }]]).fetch });
  await run(s.root, s.ownerP, 'connector.remove', { id: feed.id });
  assert.equal(sync.getAccount(s.root, feed.id), null);
  assert.equal(sync.listRecords(s.root, { accountId: feed.id }).length, 0);
});

// ---------------------------------------------------------------- the daemon's route

function fakeReqRes(path, { cookie = null, method = 'GET' } = {}) {
  const req = { url: path, method, headers: { host: 'shukatsu.example.net', 'x-forwarded-proto': 'https', ...(cookie ? { cookie: `shk_session=${cookie}` } : {}) }, socket: { remoteAddress: '127.0.0.1' } };
  const out = { status: null, headers: {} };
  const res = { headersSent: false, writeHead(status, headers) { out.status = status; out.headers = headers; this.headersSent = true; }, end() {} };
  return { req, res, out };
}

test('the daemon route handles Gmail start and callback for the owner, and nothing else', async () => {
  const s = await setup();
  const { account } = await addGmail(s);
  const owner = createSession(s.root, s.owner).token;
  const call = async (path, cookie, extra = {}) => {
    const { req, res, out } = fakeReqRes(path, { cookie });
    const handled = await connectors.handleConnector(req, res, makeCtx(req, res, { root: s.root }), extra);
    return { handled, ...out };
  };

  assert.equal((await call('/api/v1/ops', owner)).handled, false);
  assert.equal((await call('/connectors/ics-in/callback', owner)).handled, false);
  assert.equal((await call('/connectors/gmail/other', owner)).handled, false);

  const anon = await call(`/connectors/gmail/start?account=${account.id}`, null);
  assert.deepEqual([anon.handled, anon.status, anon.headers.Location], [true, 302, '/login']);
  const editor = createSession(s.root, s.editor).token;
  assert.equal((await call(`/connectors/gmail/start?account=${account.id}`, editor)).status, 403);

  const start = await call(`/connectors/gmail/start?account=${account.id}`, owner);
  assert.equal(start.status, 302);
  const google = new URL(start.headers.Location);
  assert.equal(google.hostname, 'accounts.google.com');
  assert.equal(google.searchParams.get('redirect_uri'), 'https://shukatsu.example.net/connectors/gmail/callback');

  const net = fakeNet([...GMAIL_ROUTES()]);
  const wrong = await call('/connectors/gmail/callback?code=abc&state=nope', owner, { fetch: net.fetch });
  assert.match(wrong.headers.Location, /^\/settings\/connectors\?error=/);
  const ok = await call(`/connectors/gmail/callback?code=abc&state=${google.searchParams.get('state')}`, owner, { fetch: net.fetch });
  assert.equal(ok.headers.Location, `/settings/connectors?connected=${account.id}`);
  assert.equal(sync.getSecret(s.root, account.id).refresh_token, '1//recorded-refresh-token');
  const denied = await call('/connectors/gmail/callback?error=access_denied', owner);
  assert.match(denied.headers.Location, /error=Google\+said/);
  await new Promise((r) => setTimeout(r, 200)); // the first sync starts in the background
});

test('boot registers the busy source once per registry, and an extra list of operations is optional', async () => {
  const root = makeRoot();
  let added = 0;
  const reg = (fn) => { added++; assert.equal(typeof fn, 'function'); };
  await connectors.boot(root, { register: () => {}, addBusySource: reg });
  await connectors.boot(root, { register: () => {}, addBusySource: reg });
  assert.equal(added, 1);
  assert.ok(existsSync(join(root, '.shukatsu', 'sync.db')));
});
