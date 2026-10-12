#!/usr/bin/env node
/**
 * The product site's screenshots, taken from the real app.
 *
 * The site shows what the app looks like, so the pictures come from the app
 * itself rather than from a mockup that can drift. This script builds a
 * throwaway data root from the test fixture (a made-up candidate, "Test
 * Candidate"), seeds enough activity through the engine's own functions that
 * every screen has something honest to show, starts the production build of
 * the app on it, signs in through the real login form as the candidate, and
 * captures four screens in English and Japanese, light and dark. Nothing here
 * can touch the real data root: the app is started with CAREER_OPS_DATA_DIR
 * pointing at the temp copy, the marker file is never read, and every page is
 * checked for the fixture candidate's name before anything is saved.
 *
 * The seeded story, all invented: Mom (editor, Japanese) has two proposals
 * waiting, a new line for the cafe job with its Japanese wording and a better
 * Japanese wording for an existing line, and has prepared a Japanese 職務経歴書
 * packet that passed its check and is waiting for the candidate. Mentor
 * (reviewer) commented on Mom's proposal and suggested two postings. The
 * candidate has confirmed some lines, sent one application, and has two more
 * in the tracker. The engine stamps events with the real clock, so the seeding
 * runs under a shifted clock to make the activity read hours and days old, the
 * way it would in use; the app itself runs in real time.
 *
 * Run from site/:  npm run shots   (about 25 seconds with a warm build cache, a minute cold)
 *   --reuse-build  skip `next build` when shukatsu/.next already has one
 *   --keep         leave the throwaway root in place and print where it is
 *   --seed-only    seed the throwaway root, print it, and stop (implies --keep)
 * Needs: Playwright (site/node_modules), cwebp on PATH (brew install webp), and
 * network access on the first build, because next/font fetches Google Fonts.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SITE, '..');
const APP = join(REPO, 'shukatsu');
const OUT = join(SITE, 'public', 'shots');
const CWEBP = process.env.CWEBP || 'cwebp';

const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 1.5;
const LANGS = ['en', 'ja'];
const THEMES = ['light', 'dark'];

const NAME = 'Test Candidate';
const LOGIN = 'candidate';
const PASSWORD = 'shots-only passphrase';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- the made-up story

const JD_EN = 'We need an operations intern to own lead routing and KPI dashboards for our sales team.';
const JD_JA = '営業チームのリード管理とKPIダッシュボードの運用を担当する、長期インターンを募集します。';

// Japanese answers for the form. Every figure is one a confirmed fact states
// (6, 40, 5, 1,200, 120), and no 1日 or 1月 sneaks in as a stray "1", because
// the packet check holds written answers to the same rule as bullets.
const SELF_PR = '私の強みは、日々の業務で起きている手間を数字で捉え、仕組みの改善につなげる力です。Acmeでのインターンでは、6名のチームが担当していたリード振り分けの手作業が毎日40分かかっていることに気づき、週1,200件のリードを扱える形に振り分けの流れを再構築しました。その結果、手作業は毎日5分まで減りました。この経験から、改善の成果は数字で示してはじめて、チームに伝わることを学びました。そのため、作る前に現状の所要時間を測り、作った後にも同じ指標で確かめることを心がけています。また、Corner Cafeでは観光シーズンに、毎シフト約120名のお客様を英語と日本語で接客し、相手に合わせて言葉を選ぶ姿勢を身につけました。貴社でも、現場の方々の声を聞きながら、数字で確かめられる改善を積み重ねていきたいです。';
const MOTIVATION = '貴社の長期インターンでは、営業チームのリード管理やKPIの運用に関われると知り、強く惹かれました。営業チームを支える仕事は、数字を扱う点でこれまでの経験と重なると感じました。Acmeでリード振り分けの手作業を毎日40分から5分に減らした経験は、貴社の現場でも活かせると考えています。また、英語と日本語の両方で人と向き合ってきた経験を、社内外のコミュニケーションに役立てたいです。年明けから半年間、現場で働く方々から学びながら、早く戦力になれるよう努め、しっかり貢献したいと考えています。';

// ---------------------------------------------------------------- plumbing

const log = (...a) => console.log('[shots]', ...a);
const fail = (msg) => { throw new Error(msg); };

const free = (port) => new Promise((ok) => {
  const s = createServer();
  s.once('error', () => ok(false));
  s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
});
async function freePort(from) {
  for (let p = from; p < from + 50; p++) if (await free(p)) return p;
  return fail(`No free port near ${from}.`);
}

/**
 * The engine stamps every event with the real clock. To make seeded activity
 * read as hours and days old, the seeding runs with `Date` shifted back by
 * `clock.at(msAgo)`. Only this process is affected, and only while seeding.
 */
const RealDate = Date;
let skew = 0;
class ShiftedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + skew); }
  static now() { return RealDate.now() + skew; }
}
const clock = {
  at(msAgo) { skew = -msAgo; globalThis.Date = ShiftedDate; },
  real() { skew = 0; globalThis.Date = RealDate; },
};
const isoDay = (msAgo) => new RealDate(RealDate.now() - msAgo).toISOString().slice(0, 10);

/** The engine, loaded from the checkout the same way the app loads it. */
async function loadEngine() {
  const core = (m) => import(pathToFileURL(join(APP, 'core', `${m}.mjs`)).href);
  const names = ['people', 'proposals', 'review', 'packets', 'tracker', 'store', 'candidate', 'facts'];
  const mods = await Promise.all(names.map(core));
  const helpers = await import(pathToFileURL(join(APP, 'tests', 'helpers.mjs')).href);
  return { ...Object.fromEntries(names.map((n, i) => [n, mods[i]])), makeRoot: helpers.makeRoot };
}

/** A throwaway copy of the fixture, as a data root with its own git history. */
function makeThrowawayRoot(E) {
  const root = realpathSync(E.makeRoot());
  const tmp = realpathSync(tmpdir());
  if (!root.startsWith(`${tmp}/`)) fail(`Refusing to use ${root}: not inside the temp directory.`);
  // The candidate's commits are signed with the root's own identity, never this machine's.
  for (const [k, v] of [['user.name', NAME], ['user.email', 'test@example.com']]) {
    spawnSync('git', ['config', k, v], { cwd: root });
  }
  return root;
}

/** Seed people, proposals, comments, packets and tracker rows through the engine. */
export async function seed(root, E) {
  const { people, proposals, review, packets, tracker, store, candidate, facts } = E;
  const ids = {};
  const join_ = (token, login) => people.acceptInvite(root, token, { login, password: PASSWORD });

  clock.at(9 * DAY);
  const owner = join_(people.createInvite(root, { actor: null, role: 'owner', name: NAME }), LOGIN);
  clock.at(9 * DAY - HOUR);
  const mom = join_(people.createInvite(root, { actor: owner, role: 'editor', name: 'Mom', relation: 'Mother', lang: 'ja' }), 'mom');
  const mentor = join_(people.createInvite(root, { actor: owner, role: 'reviewer', name: 'Mentor' }), 'mentor');
  candidate.setCandidateJa(root, { actor: owner, values: { name: '試験 太郎', location: 'アメリカ・ボストン', availability: '6ヶ月の長期インターン（2027年1月〜6月）' } });

  // The candidate works through the drafts the fixture starts with.
  clock.at(8 * DAY);
  review.decide(root, { actor: owner, key: 'draft:entity:cafe', outcome: 'accept' });
  review.decide(root, { actor: owner, key: 'draft:ja:acme.routing', outcome: 'accept' });

  // Mom adds a line for the cafe job with its Japanese wording; the candidate confirms both.
  clock.at(7 * DAY);
  const first = proposals.propose(root, {
    actor: mom, kind: 'fact.new',
    payload: { entity: 'cafe', text: 'Greeted about 120 customers a shift in English and Japanese during the tourist season.', ja: '観光シーズン中、毎シフト約120名のお客様を英語と日本語で接客。' },
    note: 'お店で一緒だった方から聞いた数字です。',
  });
  clock.at(6 * DAY);
  review.decide(root, { actor: owner, key: `proposal:${first}`, outcome: 'accept' });
  const greeted = facts.loadProfile(root)._entities.find((e) => e.id === 'cafe').facts[0].id;
  review.decide(root, { actor: owner, key: `draft:ja:${greeted}`, outcome: 'accept' });

  // Mentor suggests a posting; the candidate takes it into the inbox.
  clock.at(6 * DAY - 2 * HOUR);
  const inbox = proposals.propose(root, {
    actor: mentor, kind: 'posting',
    payload: { url: 'https://jobs.example.com/foods/supply-chain-intern', company: 'Example Foods', role: 'Supply Chain Intern', note: 'On the co-op portal this week' },
  });
  clock.at(5 * DAY);
  review.decide(root, { actor: owner, key: `proposal:${inbox}`, outcome: 'accept' });

  // The tracker: one application sent through a packet, one in interviews, one just evaluated.
  clock.at(7 * DAY);
  const labs = tracker.addTrackerRow(root, { company: 'Example Labs', role: 'Data Analyst Co-op', status: 'Evaluated', score: '4.3/5', url: 'https://jobs.example.com/labs/analyst' });
  clock.at(6 * DAY);
  tracker.addTrackerRow(root, { company: 'Example Co', role: 'Operations Intern', status: 'Evaluated', score: '4.4/5', url: 'https://jobs.example.com/co/ops-intern' });
  clock.at(5 * DAY);
  tracker.setStatus(root, labs.num, 'Applied', 'Applied on the careers site');
  const sent = packets.createPacket(root, { actor: owner, company: 'Example Co', role: 'Operations Intern', url: 'https://jobs.example.com/co/ops-intern', jdText: JD_EN, archetype: 'analyst' });
  if (!packets.checkPacket(root, { actor: owner, id: sent }).ok) fail('The English packet did not pass its check.');
  packets.markReady(root, { actor: owner, id: sent });
  clock.at(4 * DAY);
  packets.markSent(root, { actor: owner, id: sent, on: isoDay(4 * DAY) });
  clock.at(2 * DAY);
  tracker.setStatus(root, labs.num, 'Interview', 'Phone screen booked');
  tracker.addTrackerRow(root, { company: 'Example Retail', role: 'Business Analyst Intern', status: 'Evaluated', score: '4.1/5', url: 'https://jobs.example.com/retail/analyst' });
  packets.createPacket(root, { actor: owner, company: 'Example Retail', role: 'Business Analyst Intern', url: 'https://jobs.example.com/retail/analyst', jdText: JD_EN, archetype: 'analyst' });

  // Mom prepares a Japanese packet: 職務経歴書, two written answers, a passing check.
  clock.at(22 * HOUR);
  ids.packet = packets.createPacket(root, { actor: mom, company: 'Example KK', role: '長期インターン（事業開発）', url: 'https://jobs.example.com/kk/intern', jdText: JD_JA, archetype: 'analyst', lang: 'ja' });
  packets.setAnswers(root, { actor: mom, id: ids.packet, answers: [
    { question: '自己PR', limit: 400, unit: 'chars', text: SELF_PR },
    { question: '志望動機', limit: 300, unit: 'chars', text: MOTIVATION },
  ] });
  const checked = packets.checkPacket(root, { actor: mom, id: ids.packet });
  if (!checked.ok) fail(`The Japanese packet did not pass its check:\n${checked.problems.join('\n')}`);
  clock.at(21 * HOUR);
  packets.submitForReview(root, { actor: mom, id: ids.packet });
  store.addComment(root, { actor: mom, subject: `packet:${ids.packet}`, body: '自己PRは400字の枠に収め、数字は本人が確認した事実だけを使いました。ご確認をお願いします。' });

  // Two proposals from Mom wait in the queue, the cafe one first.
  clock.at(18 * HOUR);
  ids.cafe = proposals.propose(root, {
    actor: mom, kind: 'fact.new',
    payload: { entity: 'cafe', text: 'Trained 2 new part-time staff on the espresso machine and the register during a 3-week autumn rush.', ja: '秋の繁忙期の3週間、新人アルバイト2名にエスプレッソマシンとレジの使い方を指導。' },
    note: '数字は当時の店長さんから聞いた話です。間違っていたら直してください。',
  });
  clock.at(16 * HOUR);
  ids.reword = proposals.propose(root, {
    actor: mom, kind: 'fact.edit',
    payload: { id: 'acme.routing', part: 'ja', text: '6名のチームが使うリード振り分けの仕組みを作り直し、週1,200件のリードにかかっていた手作業を、毎日40分から5分へ短縮。' },
    note: '「再構築」は少し硬いので「作り直し」にしました。意味は変えていません。',
  });
  clock.at(5 * HOUR);
  store.addComment(root, { actor: mentor, subject: `proposal:${ids.cafe}`, body: 'Both numbers are specific, which helps. Worth asking the cafe manager to confirm the 2 and the 3 weeks before you keep them.' });
  clock.at(4 * HOUR);
  store.addComment(root, { actor: mentor, subject: 'draft:fact:acme.dashboard', body: 'This is the strongest line in the Acme section. The Monday review shows someone really used it.' });
  clock.at(3 * HOUR);
  proposals.propose(root, {
    actor: mentor, kind: 'posting',
    payload: { url: 'https://jobs.example.com/mobility/operations-co-op', company: 'Example Mobility', role: 'Operations Co-op', note: 'Saw this on the career center board' },
  });
  clock.real();

  const waiting = review.summary(root);
  log(`seeded: ${waiting.total} waiting (${waiting.fromPeople} from people), ${tracker.readTracker(root).rows.length} tracked`);
  return ids;
}

// ---------------------------------------------------------------- the app

function run(cmd, args, opts) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', no);
    p.on('close', (code) => (code === 0 ? ok(out) : no(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out.split('\n').slice(-30).join('\n')}`))));
  });
}

/** A clean environment for the app: the throwaway root, nothing else that could point elsewhere. */
function appEnv(root, port) {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    CAREER_OPS_DATA_DIR: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    SHUKATSU_URL: `http://127.0.0.1:${port}`,
  };
}

const NEXT = join(APP, 'node_modules', 'next', 'dist', 'bin', 'next');

async function startApp(root, port, reuse) {
  const env = appEnv(root, port);
  if (reuse && existsSync(join(APP, '.next', 'BUILD_ID'))) log('reusing the existing build');
  else {
    log('building the app (this is the slow part)');
    await run(process.execPath, [NEXT, 'build'], { cwd: APP, env });
  }
  const server = spawn(process.execPath, [NEXT, 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: APP, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => { tail = (tail + d).slice(-4000); });
  server.logs = () => tail;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) fail(`The app exited early:\n${tail}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return server; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return fail(`The app did not come up:\n${tail}`);
}

function stopApp(server) {
  if (!server || server.exitCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
}

// ---------------------------------------------------------------- capture

const SCREENS = (ids) => [
  { name: 'today', path: '/today' },
  { name: 'review', path: `/review?item=${encodeURIComponent(`proposal:${ids.cafe}`)}`, expect: 'Mom' },
  { name: 'record', path: '/record', expect: 'acme.routing' },
  { name: 'packet', path: `/packets/${ids.packet}`, expect: 'Example KK' },
];

async function settle(page) {
  await page.waitForLoadState('networkidle');
  // Fonts load on first use (the Japanese faces arrive in slices), so wait until nothing is pending.
  let calm = 0;
  for (let i = 0; i < 40 && calm < 3; i++) {
    await page.evaluate(() => document.fonts.ready);
    const loading = await page.evaluate(() => [...document.fonts].some((f) => f.status === 'loading'));
    calm = loading ? 0 : calm + 1;
    await page.waitForTimeout(100);
  }
}

async function signIn(browser, base) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="login"]', LOGIN);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL('**/today'), page.click('form:has(input[name="password"]) button[type="submit"]')]);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Switch the signed-in person's language the way anyone does: the button in the header. */
async function switchLanguage(browser, base, state, lang) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${base}/today`);
  if ((await page.getAttribute('html', 'lang')) !== lang) {
    await Promise.all([page.waitForLoadState('load'), page.click('header form:has(input[name="lang"]) button[type="submit"]')]);
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  }
  await ctx.close();
}

async function capture(browser, base, state, ids, pngDir) {
  const files = [];
  for (const lang of LANGS) {
    await switchLanguage(browser, base, state, lang);
    for (const theme of THEMES) {
      const ctx = await browser.newContext({
        viewport: VIEWPORT, deviceScaleFactor: SCALE, storageState: state, colorScheme: theme, locale: lang === 'ja' ? 'ja-JP' : 'en-US',
      });
      const page = await ctx.newPage();
      for (const s of SCREENS(ids)) {
        await page.goto(`${base}${s.path}`);
        await settle(page);
        // Never save a page that isn't the fixture candidate's, in the right language, and working.
        const url = new URL(page.url());
        if (url.pathname === '/login') fail(`${s.name}: sent to sign-in; the session did not carry over.`);
        const text = await page.evaluate(() => document.body.textContent || '');
        if (!text.includes(NAME)) fail(`${s.name}: the page does not show "${NAME}"; refusing to capture.`);
        if (s.expect && !text.includes(s.expect)) fail(`${s.name}: expected "${s.expect}" on the page, so it is not showing what it should.`);
        if (/Application error|This page couldn.t load|Internal Server Error/i.test(text)) fail(`${s.name}: the page shows an error.`);
        if ((await page.getAttribute('html', 'lang')) !== lang) fail(`${s.name}: expected lang=${lang}.`);
        const png = join(pngDir, `${lang}-${theme}-${s.name}.png`);
        await page.screenshot({ path: png, animations: 'disabled' });
        files.push({ png, lang, theme, name: s.name });
        log(`captured ${lang}/${theme}/${s.name}`);
      }
      await ctx.close();
    }
  }
  return files;
}

function toWebp(files) {
  for (const f of files) {
    const dir = join(OUT, f.lang, f.theme);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${f.name}.webp`);
    const r = spawnSync(CWEBP, ['-quiet', '-q', '82', f.png, '-o', out], { encoding: 'utf-8' });
    if (r.status !== 0) fail(`cwebp failed for ${f.png}: ${r.stderr}`);
  }
  log(`wrote ${files.length} images to ${OUT}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const reuse = process.argv.includes('--reuse-build');
  const seedOnly = process.argv.includes('--seed-only');
  const keep = seedOnly || process.argv.includes('--keep');
  if (spawnSync(CWEBP, ['-version']).error) fail(`cwebp not found (${CWEBP}). Install it with brew install webp, or set CWEBP.`);
  const started = Date.now();

  const E = await loadEngine();
  const root = makeThrowawayRoot(E);
  // From here on, anything the engine or its child processes resolve points at the throwaway root.
  process.env.CAREER_OPS_DATA_DIR = root;
  delete process.env.CAREER_OPS_ROOT;
  delete process.env.CAREER_OPS_TRACKER;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  if (E.facts.loadProfile(root).candidate?.name !== NAME) fail(`The throwaway root is not the fixture candidate (${NAME}).`);
  log(`throwaway root: ${root}`);

  let server = null;
  let browser = null;
  const pngDir = mkdtempSync(join(tmpdir(), 'shukatsu-shots-png-'));
  const cleanup = () => {
    stopApp(server);
    if (!keep) rmSync(root, { recursive: true, force: true });
    rmSync(pngDir, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

  try {
    const ids = await seed(root, E);
    if (seedOnly) { log(`ids: ${JSON.stringify(ids)}`); return; }
    const port = await freePort(Number(process.env.SHOTS_PORT) || 3150);
    server = await startApp(root, port, reuse);
    const base = `http://127.0.0.1:${port}`;
    log(`app up at ${base}`);
    browser = await chromium.launch();
    const state = await signIn(browser, base);
    const files = await capture(browser, base, state, ids, pngDir);
    toWebp(files);
  } catch (err) {
    if (server?.logs) console.error(`[shots] app log tail:\n${server.logs()}`);
    throw err;
  } finally {
    await browser?.close();
    cleanup();
    if (keep) log(`kept the throwaway root: ${root}`);
  }
  log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
