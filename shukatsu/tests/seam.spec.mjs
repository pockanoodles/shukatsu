/**
 * The seam: everything the app takes from the career-ops engine.
 *
 * The app imports nine engine modules and runs six engine CLIs. A career-ops
 * release that changes one of them should fail here, by name, before it breaks
 * a page. SEAM (core/seam.mjs) is the declaration. The first test derives the
 * real list from the app's source and fails when the two disagree, so a new
 * import or spawn has to be declared (and given a behaviour test) to land.
 *
 * Each behaviour test asserts only what the app's call site relies on, so an
 * upstream refactor that keeps the contract passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { addTrackerRow, canonicalStates, runEngine, setStatus, statusLog } from '../core/tracker.mjs';
import { SEAM, seamClosure } from '../core/seam.mjs';
import { runGate } from '../core/trace.mjs';
import { upstreamValidate } from '../core/validate.mjs';
import { makeRoot } from './helpers.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const ENGINE = dirname(APP);

/** The app's source files, tracked or new, from git rather than a directory walk. */
function sources(dir) {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: dir, encoding: 'utf-8' });
  return r.stdout.split('\n')
    .filter((p) => /\.(mjs|js|ts|tsx)$/.test(p) && !/^(tests|docs)\//.test(p) && existsSync(join(dir, p)))
    .map((p) => join(dir, p));
}

/** What the app's source actually takes from the engine. */
function derived() {
  const imports = {};
  const files = new Set();
  for (const file of sources(APP)) {
    const text = readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/import\s*(?:\{([^}]*)\}\s*from\s*)?['"]((?:\.\.\/)+[^'"]+)['"]/g)) {
      const rel = relative(ENGINE, resolve(dirname(file), m[2]));
      if (rel.startsWith('shukatsu/') || rel.startsWith('..')) continue;
      const names = (m[1] || '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      imports[rel] = [...new Set([...(imports[rel] || []), ...names])].sort();
    }
    const spawned = [
      ...text.matchAll(/runEngine\('([^']+)'/g),
      ...text.matchAll(/runGate\('[^']+', '([^']+)'/g),
      ...[...text.matchAll(/join\(ENGINE, ((?:'[^']+'(?:, )?)+)\)/g)].map((m) => [m[0], m[1].split(/',\s*'/).map((s) => s.replace(/'/g, '')).join('/')]),
    ];
    for (const [, path] of spawned) if (!path.startsWith('shukatsu/')) files.add(path);
  }
  return { imports, files: [...files].sort() };
}

test('the declared seam is exactly what the app takes from the engine', () => {
  const real = derived();
  const declared = Object.fromEntries(Object.entries(SEAM.imports).map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(real.imports, declared, 'an engine import changed: update SEAM.imports and give it a behaviour test below');
  assert.deepEqual(real.files, [...SEAM.files].sort(), 'an engine CLI or file changed: update SEAM.files and give it a behaviour test below');
});

test('every declared engine module still exports what the app imports', async () => {
  for (const [mod, names] of Object.entries(SEAM.imports)) {
    const m = await import(join(ENGINE, mod));
    for (const name of names) assert.equal(typeof m[name], 'function', `${mod} no longer exports ${name}()`);
  }
  for (const f of SEAM.files) assert.ok(existsSync(join(ENGINE, f)), `${f} is gone from the engine`);
});

test('the seam closure follows each module\'s own imports, and stays inside the engine', () => {
  const closure = seamClosure(ENGINE);
  for (const p of [...Object.keys(SEAM.imports), ...SEAM.files]) assert.ok(closure.includes(p));
  assert.ok(closure.length > Object.keys(SEAM.imports).length + SEAM.files.length, 'the seam modules load other engine modules');
  assert.ok(closure.every((p) => !p.startsWith('..') && !p.startsWith('shukatsu/') && existsSync(join(ENGINE, p))), closure.filter((p) => !existsSync(join(ENGINE, p))).join(', '));
});

test('url-key: a posting URL normalizes to its dedup key, and a non-URL to empty', async () => {
  const { normalizeUrl } = await import(join(ENGINE, 'url-key.mjs'));
  assert.equal(normalizeUrl('https://Jobs.Example.com/a/?utm_source=x'), 'https://jobs.example.com/a');
  assert.equal(normalizeUrl('not a url'), '', 'the app falls back to the raw string on empty');
});

test('tracker-parse: a row reads by column name, with the URL cell\'s href', async () => {
  const { parseTrackerRow, resolveColumns } = await import(join(ENGINE, 'tracker-parse.mjs'));
  const lines = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| 3 | 2026-10-01 | Acme | Analyst | 4.1/5 | Applied | ❌ | — | req 12 | [ashby](https://jobs.ashbyhq.com/acme/1) |',
  ];
  const cols = resolveColumns(lines);
  const [row] = lines.map((l) => parseTrackerRow(l, cols)).filter(Boolean);
  assert.deepEqual(
    { num: row.num, company: row.company, role: row.role, status: row.status, notes: row.notes, url: row.url },
    { num: 3, company: 'Acme', role: 'Analyst', status: 'Applied', notes: 'req 12', url: 'https://jobs.ashbyhq.com/acme/1' },
  );
});

test('path-resolver: the tracker reads from the root\'s file and writes to data/applications.md', async () => {
  const { getCareerOpsRoot, resolveTrackerPath, resolveTrackerPathForWrite } = await import(join(ENGINE, 'path-resolver.mjs'));
  const root = realpathSync(makeRoot());
  assert.equal(resolveTrackerPathForWrite(root), join(root, 'data', 'applications.md'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n');
  assert.equal(resolveTrackerPath(root), join(root, 'data', 'applications.md'));
  const before = process.env.CAREER_OPS_DATA_DIR;
  process.env.CAREER_OPS_DATA_DIR = root;
  try { assert.equal(getCareerOpsRoot(), root, 'CAREER_OPS_DATA_DIR picks the data root'); } finally {
    if (before === undefined) delete process.env.CAREER_OPS_DATA_DIR; else process.env.CAREER_OPS_DATA_DIR = before;
  }
});

test('reply-matcher: a rejection classifies as Rejected, and a reply matches its tracker row', async () => {
  const { classifyReply, matchCandidates, getAppDomains } = await import(join(ENGINE, 'reply-matcher.mjs'));
  // kindOf() in connectors/signals.mjs branches on these type names; a rename would fall through to "other".
  const typeOf = (subject, body) => classifyReply({ from: 'recruiting@acme.com', subject, body_snippet: body }).type;
  assert.equal(typeOf('Your application to Acme', 'Unfortunately, we have decided not to move forward with your application.'), 'Rejected');
  assert.equal(typeOf('Thank you for applying', 'We received your application and will review it.'), 'Auto-confirmation');
  assert.equal(typeOf('Offer letter', 'We are pleased to offer you the position.'), 'Offer');
  assert.equal(typeOf('Complete your assessment', 'Please complete the online assessment within 5 days.'), 'Need Action');
  const rows = [{ num: 3, company: 'Acme', role: 'Analyst', status: 'Applied', url: 'https://careers.acme.com/jobs/1', notes: '' }];
  const [m] = matchCandidates([{ message_id: '1', from: 'recruiting@acme.com', subject: 'Acme Analyst application', body_snippet: 'Thanks for applying to the Analyst role at Acme', received_at: '2026-10-02' }], rows);
  assert.equal(m.application_num, 3);
  assert.ok(['high', 'medium', 'low'].includes(m.confidence));
  assert.ok([...getAppDomains(rows[0], [])].includes('acme.com'), 'the Gmail query is built from these domains');
});

test('reply-matcher: a company is named by its name in any case or spacing, a short one only as a whole word', async () => {
  const { checkCompanyMatch, normalizeStr } = await import(join(ENGINE, 'reply-matcher.mjs'));
  // signals.mjs finds one company's several rows with these, to choose between them.
  assert.equal(checkCompanyMatch('Your application to INITECH, Tokyo', 'Initech'), true);
  assert.equal(checkCompanyMatch('Acme Robotics careers', 'AcmeRobotics'), true);
  assert.equal(checkCompanyMatch('Join the Zyxers', 'Zyx'), false);
  assert.equal(checkCompanyMatch('Greetings from Zyx Japan', 'Zyx'), true);
  assert.equal(normalizeStr('Acme  Robotics'), normalizeStr('acme robotics'));
});

test('invite-match: an interview invitation classifies as invite, with the fields the app reads', async () => {
  const { analyzeInvite } = await import(join(ENGINE, 'invite-match.mjs'));
  const r = analyzeInvite('Interview invitation\nWe would like to invite you to an interview for the Analyst role at Acme.', []);
  assert.equal(r.classification, 'invite');
  assert.ok('phraseStrength' in r && Array.isArray(r.candidates));
});

test('check-jd-archive: a report needs its verbatim job description', async () => {
  const { hasEmbeddedJdArchive } = await import(join(ENGINE, 'check-jd-archive.mjs'));
  assert.equal(hasEmbeddedJdArchive('# Report\n\nno posting here'), false);
  const jd = 'We are hiring an analyst to build dashboards and models for the operations team. '.repeat(10);
  assert.equal(hasEmbeddedJdArchive(`# Report\n\n## Job Description (archived verbatim)\n\n${jd}`), true);
});

test('plugins: the connector context has a fetch, and loopback addresses are refused', async () => {
  const { buildCtx } = await import(join(ENGINE, 'plugins/_engine.mjs'));
  const { resolveAndValidate } = await import(join(ENGINE, 'plugins/_net.mjs'));
  assert.equal(typeof buildCtx({ requiredEnv: [], optionalEnv: [], allowedHosts: ['example.com'] }).fetch, 'function');
  await assert.rejects(resolveAndValidate('127.0.0.1'), 'the OAuth client-metadata fetch relies on this to refuse private addresses');
});

test('engine CLIs: a row is added, moved, logged, and looked up through the engine', () => {
  const root = makeRoot();
  const added = addTrackerRow(root, { company: 'Acme', role: 'Analyst', url: 'https://jobs.ashbyhq.com/acme/1' });
  assert.ok(added.ok, added.out);
  const moved = setStatus(root, added.num, 'Applied', 'sent');
  assert.ok(moved.ok, moved.out);
  assert.equal(JSON.parse(moved.out).newStatus, 'Applied', 'set-status --json reports the new state');
  const [entry] = statusLog(root).get(String(added.num));
  assert.deepEqual([entry.from, entry.to], ['Evaluated', 'Applied'], 'status-log.tsv keeps its column order');
  const history = runEngine('company-history.mjs', ['--company', 'Acme'], root);
  assert.ok(history.ok);
  assert.equal(JSON.parse(history.out).company, 'Acme');
});

test('engine CLIs: the profile validates, and the fact gate blocks a forbidden phrase', () => {
  const root = makeRoot();
  assert.ok(upstreamValidate(join(root, 'data', 'career-profile.yml')).ok);
  writeFileSync(join(root, 'config', 'cv-facts.json'), JSON.stringify({ forbidden_phrases: ['Fortune 500'] }));
  writeFileSync(join(root, 'ok.md'), '# CV\n\n- Built a dashboard\n');
  writeFileSync(join(root, 'bad.md'), '# CV\n\n- Advised a Fortune 500 client\n');
  assert.equal(runGate('facts', 'verify-cv-facts.mjs', join(root, 'ok.md'), root).ok, true);
  assert.equal(runGate('facts', 'verify-cv-facts.mjs', join(root, 'bad.md'), root).ok, false);
});

test('states.yml: the canonical states the tracker ops accept', () => {
  const ids = canonicalStates().map((s) => s.id);
  for (const s of ['evaluated', 'applied', 'interview', 'offer', 'rejected']) assert.ok(ids.map((i) => i.toLowerCase()).includes(s), `${s} is no longer a canonical state`);
});
