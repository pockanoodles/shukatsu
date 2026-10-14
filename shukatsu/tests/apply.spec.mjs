import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const { run, sessionPrincipal, tokenPrincipal } = await import('../core/ops/index.mjs');
const { createAgent, issueToken } = await import('../core/people.mjs');
const { identify, norm } = await import('../apply/fields.mjs');
const { applyKey, planForm } = await import('../apply/plan.mjs');
await import('../extension/match.js');
const { choose, countriesIn } = globalThis.__shukatsuMatch;
const { loadBank } = await import('../apply/bank.mjs');
const { platform } = await import('../platforms/index.mjs');
const { makeRoot, people } = await import('./helpers.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM_URL = 'https://job-boards.greenhouse.io/acme/jobs/4001';
const PDF = 'output/cv-test-candidate-acme-2026-10-14.pdf';
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

/** A root that knows the Acme posting, has a resume PDF for it, and has some stated answers. */
function setup() {
  const root = makeRoot();
  const cast = people(root);
  mkdirSync(join(root, 'output'), { recursive: true });
  writeFileSync(join(root, PDF), '%PDF-1.4\n% test resume\n');
  writeFileSync(join(root, 'data', 'pdf-index.tsv'), `# report\tpdf\thtml\tformat\tdate\tkind\n\t${PDF}\t\tletter\t2026-10-14\tcv\n`);
  writeFileSync(join(root, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|-----|',
    `| 1 | 2026-10-14 | Acme | Data Analyst Co-op | 4.2/5 | Evaluated | ✅ | — | | ${FORM_URL} |`, '',
  ].join('\n'));
  writeFileSync(join(root, 'data', 'form-answers.yml'), [
    'answers:', '  auth.work:', '    US: "Yes"', '  eeo.gender: Decline to self-identify',
    'questions:', '  - q: "How did you hear about this job?"', '    a: Career fair', '',
  ].join('\n'));
  const { token } = issueToken(root, { actor: cast.owner, userId: cast.owner.id, kind: 'capture', name: 'extension' });
  const agent = createAgent(root, { actor: cast.owner, name: 'Claude Code' });
  const { token: agentToken } = issueToken(root, { actor: cast.owner, userId: agent.id, kind: 'agent', name: 'laptop' });
  return { root, ...cast, ownerP: sessionPrincipal(cast.owner), extP: tokenPrincipal(root, token, { kinds: ['capture'] }), agentP: tokenPrincipal(root, agentToken) };
}

const field = (o) => ({ ref: o.ref || 'f1', kind: 'text', label: '', name: '', id: '', autocomplete: '', placeholder: '', required: false, maxlength: null, options: null, visible: true, ...o });

// ---------------------------------------------------------------- matching

test('a field is known by the strongest signal it carries', () => {
  const gh = platform('greenhouse').fill;
  assert.deepEqual(identify(field({ name: 'first_name', label: 'Something odd' }), gh), { key: 'name.given', by: 'vendor', confidence: 1 }, 'the ATS\'s own field name wins over its label');
  assert.equal(identify(field({ autocomplete: 'section-x family-name' })).key, 'name.family');
  assert.equal(identify(field({ label: 'Preferred First Name' })).key, 'name.preferred', 'the narrower question first');
  assert.equal(identify(field({ label: 'First Name *' })).key, 'name.given');
  assert.equal(identify(field({ label: 'LinkedIn Profile URL' })).key, 'link.linkedin');
  assert.equal(identify(field({ label: 'Resume/CV', kind: 'file' })).key, 'file.resume');
  assert.equal(identify(field({ label: 'Resume/CV', kind: 'text' })), null, 'a resume never goes into a text box');
  assert.equal(identify(field({ kind: 'select', label: 'Will you now or in the future require sponsorship for employment visa status?' })).key, 'auth.sponsorship');
  assert.equal(identify(field({ kind: 'select', label: 'Are you legally authorized to work in the United States?' })).key, 'auth.work');
  assert.equal(identify(field({ name: 'urls[GitHub]' }), platform('lever').fill).key, 'link.github');
  assert.equal(norm('E-mail Address (required) *'), 'e mail address');
});

test('an answer is matched to the option that says it', () => {
  const yn = [{ text: 'Select...', value: '' }, { text: 'Yes', value: '1' }, { text: 'No', value: '0' }];
  assert.deepEqual(choose(yn, 'Yes'), { index: 1, fuzzy: false });
  assert.deepEqual(choose(yn, 'no'), { index: 2, fuzzy: false });
  const long = [{ text: 'Yes, I am authorized to work in the US' }, { text: 'No, I am not authorized' }];
  assert.deepEqual(choose(long, 'Yes'), { index: 0, fuzzy: true }, 'a yes picks the one option that starts with yes');
  assert.equal(choose([{ text: 'Select...' }, { text: 'LinkedIn' }], 'Select'), null, 'a placeholder is never an answer');
  assert.deepEqual(choose([{ text: 'Boston, MA' }, { text: 'Boston, England' }], 'Boston'), { index: -1, tied: [0, 1] }, 'two equally good options are left to the candidate');
  assert.equal(choose(yn, 'Maybe'), null);
});

test('a pick never says the opposite, never guesses a word inside another, and knows aliases', () => {
  const pick = (opts, want) => choose(opts, want)?.index ?? null;
  // yes and no
  assert.equal(pick(['I am authorized to work in the US', 'I am not authorized to work in the US', 'Prefer not to say'], 'Yes'), 0, 'a yes to statements');
  assert.equal(pick(['I am authorized to work in the US', 'I am not authorized to work in the US'], 'No'), 1);
  assert.equal(pick(['I will require sponsorship', 'I will not require sponsorship'], 'No, I won\'t need sponsorship'), 1, 'one "not" apart');
  assert.equal(pick(['I will require sponsorship', 'I will not require sponsorship'], 'I will not require sponsorship now or in the future'), 1);
  assert.deepEqual(choose(['Yes, US citizen', 'Yes, green card holder', 'No'], 'Yes'), { index: -1, tied: [0, 1] }, 'which yes is the candidate\'s call');
  // whole words, not letters
  assert.equal(pick(['North Carolina', 'North Dakota'], 'No'), null, '"No" is not the start of "North"');
  assert.equal(pick(['Database administration', 'Data analysis'], 'Data'), 1);
  assert.equal(pick(['Female', 'Male (he/him)', 'Decline to self-identify'], 'Male'), 1);
  assert.equal(pick(['Boston, England, United Kingdom', 'Boston, Massachusetts, United States'], 'Boston, MA'), 1);
  // aliases
  assert.equal(pick(['Afghanistan', 'United States Minor Outlying Islands', 'United States of America'], 'USA'), 2);
  assert.equal(pick(['Maine', 'Maryland', 'Massachusetts'], 'MA'), 2);
  assert.equal(pick(['Indiana', 'Iowa'], 'in'), null, 'a lowercase word is not a state code');
  // levels and dates
  assert.equal(pick(['High School', 'Associate\'s Degree', 'Bachelor\'s Degree', 'Master\'s Degree', 'PhD'], 'B.S. Business Administration'), 2);
  assert.equal(pick(['2026', '2027', '2028', '2029'], 'May 2028'), 2);
  assert.equal(pick(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], 'May 2028'), 4);
  // never a fuzzy "Other" or "Prefer not to say"
  assert.equal(pick(['LinkedIn', 'Other (please specify)'], 'Northeastern career fair'), null);
  assert.equal(pick(['LinkedIn', 'Career Fair / On-campus', 'Referral', 'Other'], 'Career fair'), 1);
  assert.equal(pick(['Yes', 'No', 'Loading…'], 'Loading'), null, 'a list still loading is not an answer');
  assert.deepEqual([...countriesIn('Are you legally authorized to work in the U.S.?')], ['united states']);
  assert.deepEqual([...countriesIn('Tell us about yourself')], []);
});

test('a form and its posting compare equal however the link is spelled', () => {
  assert.equal(applyKey('https://job-boards.greenhouse.io/acme/jobs/4001#app'), applyKey('https://job-boards.greenhouse.io/acme/jobs/4001'));
  assert.equal(applyKey('https://boards.greenhouse.io/embed/job_app?for=acme&token=4001'), 'greenhouse:/acme/jobs/4001');
  assert.equal(applyKey('https://jobs.lever.co/acme/abc-123/apply'), applyKey('https://jobs.lever.co/acme/abc-123'));
  assert.equal(applyKey('https://jobs.ashbyhq.com/acme/uuid-1/application'), applyKey('https://jobs.ashbyhq.com/acme/uuid-1'));
});

test('the bank takes stated answers first and never derives a sensitive one', () => {
  const s = setup();
  const bank = loadBank(s.root);
  assert.equal(bank.values.get('name.given').value, 'Test');
  assert.equal(bank.values.get('name.family').value, 'Candidate');
  assert.equal(bank.values.get('auth.work').source, 'stated');
  assert.equal(bank.values.get('auth.work').byCountry.get('united states'), 'Yes', 'answered per country');
  assert.equal(bank.values.get('school').value, 'University', 'the school, not its heading with the city');
  assert.equal(bank.values.get('degree').value, 'B.S. Business Administration');
  assert.equal(bank.values.get('grad.date').value, 'May 2028', 'not "Expected May 2028"');
  assert.equal(bank.values.get('auth.sponsorship'), undefined);
  assert.equal(bank.questions[0].a, 'Career fair');
});

// ---------------------------------------------------------------- planning

test('a plan fills what is known, leaves the rest to the candidate, and never touches a hidden field', async () => {
  const s = setup();
  const fields = [
    field({ ref: 'a', name: 'first_name', label: 'First Name*', required: true }),
    field({ ref: 'b', name: 'resume', kind: 'file', label: 'Resume/CV', visible: false }),
    field({ ref: 'c', kind: 'select', label: 'Are you legally authorized to work in the United States?', options: [{ text: 'Select...', value: '' }, { text: 'Yes', value: '1' }, { text: 'No', value: '0' }], required: true }),
    field({ ref: 'd', kind: 'select', label: 'Will you require sponsorship?', options: [{ text: 'Yes', value: '1' }, { text: 'No', value: '0' }], required: true }),
    field({ ref: 'e', label: 'Website', name: 'website', visible: false }),
    field({ ref: 'f', label: 'How did you hear about this job?' }),
    field({ ref: 'g', label: 'Phone', kind: 'tel', name: 'phone' }),
    field({ ref: 'h', label: 'Why Acme? Tell us what draws you here.', kind: 'textarea', required: true }),
  ];
  const plan = await run(s.root, s.extP, 'application.plan', { url: FORM_URL, fields });
  const by = Object.fromEntries(plan.entries.map((e) => [e.ref, e]));
  assert.equal(plan.platform.id, 'greenhouse');
  assert.deepEqual(plan.posting, { company: 'Acme', role: 'Data Analyst Co-op', packet: null, status: null });
  assert.equal(by.a.value, 'Test');
  assert.equal(by.a.mark, 'sure');
  assert.equal(by.b.act, 'file', 'a file input is styled away on most forms, and still filled');
  assert.equal(plan.resume.name, 'cv-test-candidate-acme-2026-10-14.pdf');
  assert.equal(Buffer.from(plan.resume.data, 'base64').toString(), '%PDF-1.4\n% test resume\n');
  assert.deepEqual([by.c.act, by.c.option, by.c.mark], ['choose', 1, 'sure'], 'a stated answer');
  assert.deepEqual([by.d.act, by.d.mark], ['leave', 'yours'], 'sponsorship was never stated, so it is the candidate\'s');
  assert.deepEqual([by.e.act, by.e.mark], ['leave', 'skip'], 'a hidden field is a bot trap');
  assert.deepEqual([by.f.value, by.f.source], ['Career fair', 'stated']);
  assert.equal(by.g.mark, 'empty', 'optional and nothing on file');
  assert.equal(by.h.mark, 'yours', 'a required question nothing answers');
});

test('work authorization is answered only for the country the question names', () => {
  const s = setup();
  const yn = [{ text: 'Select...', value: '' }, { text: 'Yes' }, { text: 'No' }];
  const plan = (label) => planForm(s.root, { url: FORM_URL, fields: [field({ kind: 'select', label, options: yn })] }).entries[0];
  assert.deepEqual([plan('Are you authorized to work in the US?').option, plan('Are you authorized to work in the US?').mark], [1, 'sure']);
  const canada = plan('Are you legally authorized to work in Canada?');
  assert.deepEqual([canada.act, canada.mark], ['leave', 'yours']);
  assert.match(canada.note, /Canada/);
  const unnamed = plan('Are you legally authorized to work?');
  assert.deepEqual([unnamed.option, unnamed.mark], [1, 'check'], 'no country named: the one listed, for a look');
  assert.match(unnamed.note, /United States/);
});

test('on Lever a box or radio is left to the candidate, since a scripted click trips its captcha', () => {
  const s = setup();
  const plan = planForm(s.root, {
    url: 'https://jobs.lever.co/acme/abc-123/apply',
    fields: [field({ ref: 'r', kind: 'radio', label: 'Gender', options: [{ text: 'Male' }, { text: 'Female' }, { text: 'Decline to self-identify' }] })],
  });
  assert.deepEqual([plan.entries[0].act, plan.entries[0].mark, plan.entries[0].option], ['leave', 'yours', 2]);
  assert.match(plan.entries[0].note, /Decline to self-identify/);
});

test('only the candidate\'s own key plans a form, and recording a fill is not sending it', async () => {
  const s = setup();
  await rejects(run(s.root, s.agentP, 'application.plan', { url: FORM_URL, fields: [] }), 'denied');
  const out = await run(s.root, s.extP, 'application.filled', { url: FORM_URL, filled: 9, check: 1, yours: 2, restored: 1, ms: 1800 });
  assert.deepEqual(out, { ok: true });
  await rejects(run(s.root, s.extP, 'packet.markSent', { id: 1 }), 'scope');
});

// ---------------------------------------------------------------- the filler, in a real browser

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; }

/** What background.js injects, in its order. */
async function inject(page) {
  for (const f of ['match.js', 'filler.js']) await page.addScriptTag({ path: join(HERE, '..', 'extension', f) });
}

test('the filler beats the site\'s resume parser, a React input, and a late overwrite, and never presses Submit', { skip: !chromium && 'playwright is not installed' }, async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip(`chromium did not start: ${e.message}`); return; }
  try {
    const s = setup();
    const page = await browser.newPage();
    await page.route('https://job-boards.greenhouse.io/**', (r) => r.fulfill({ contentType: 'text/html', body: readFileSync(join(HERE, 'fixtures', 'forms', 'greenhouse.html'), 'utf-8') }));
    await page.goto(FORM_URL);
    await inject(page);

    const read = await page.evaluate(() => globalThis.__shukatsuFill.read({ fresh: true }));
    const website = read.fields.find((f) => f.name === 'website');
    assert.equal(website.visible, false, 'the trap is seen as hidden');
    assert.equal(read.fields.find((f) => f.name === 'gender').label, 'Gender');
    assert.equal(read.fields.find((f) => f.name === 'question_2').required, true);

    const plan = await run(s.root, s.extP, 'application.plan', { url: read.url, fields: read.fields });
    const done = await page.evaluate((p) => globalThis.__shukatsuFill.act(p), plan);
    const row = (name) => done.rows.find((r) => r.ref === read.fields.find((f) => f.name === name).ref);

    await page.evaluate(() => { window.__reports = []; globalThis.__shukatsuFill.watch({ ms: 3000, report: (m) => window.__reports.push(JSON.parse(JSON.stringify(m))) }); });
    await page.waitForFunction(() => window.__reports.some((m) => m.final), null, { timeout: 8000 });
    const final = await page.evaluate(() => window.__reports.find((m) => m.final).rows);
    const after = (name) => final.find((r) => r.ref === read.fields.find((f) => f.name === name).ref);

    const v = (sel) => page.$eval(sel, (el) => el.value);
    assert.equal(await v('#first_name'), 'Test', 'written over what the resume parser put there');
    assert.equal(await page.evaluate(() => window.__state.first_name), 'Test', 'and the framework\'s own state took it');
    assert.equal(await v('#last_name'), 'Candidate', 'the late overwrite was put back');
    assert.equal(after('last_name').state, 'restored');
    assert.equal(await v('#email'), 'test@example.com');
    assert.equal(await v('#website'), '', 'the bot trap stayed empty');
    assert.equal(await page.$eval('#resume', (el) => el.files[0]?.name), 'cv-test-candidate-acme-2026-10-14.pdf');
    assert.equal(await v('#question_1'), 'Career fair');
    assert.equal(await page.$eval('#question_2', (el) => el.options[el.selectedIndex].text), 'Yes');
    assert.equal(await v('#question_3'), '', 'sponsorship is left for the candidate');
    assert.equal(row('question_3').mark, 'yours');
    assert.equal(await page.$eval('input[name=gender][value=x]', (el) => el.checked), true);
    assert.equal(row('company').mark, 'check', 'a field the site filled from the resume is flagged');
    assert.match(row('company').note, /site filled this/);
    assert.equal(await page.evaluate(() => window.__submitted === true), false, 'Submit is never pressed');
    assert.match(await page.$eval('#submit_app', (el) => el.style.outline), /solid/, 'and outlined, so the candidate sees it is theirs');
    assert.ok(done.ms < 6000, `filled in ${done.ms} ms`);
  } finally {
    await browser.close();
  }
});

test('dropdowns get the right option: searched, statement-style, one "not" apart, filled in late, or tied to no list', { skip: !chromium && 'playwright is not installed' }, async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip(`chromium did not start: ${e.message}`); return; }
  try {
    const s = setup();
    writeFileSync(join(s.root, 'data', 'form-answers.yml'), [
      'answers:', '  auth.work:', '    United States: "Yes"', '  auth.sponsorship:', '    US: "Yes"',
      'questions:', '  - q: "How did you hear about this job?"', '    a: Career fair', '',
    ].join('\n'));
    const page = await browser.newPage();
    await page.route('https://job-boards.greenhouse.io/**', (r) => r.fulfill({ contentType: 'text/html', body: readFileSync(join(HERE, 'fixtures', 'forms', 'dropdowns.html'), 'utf-8') }));
    await page.goto(FORM_URL);
    await inject(page);

    // What background.js does: read, plan, fill; then plan and fill what the first round changed.
    const read = await page.evaluate(() => globalThis.__shukatsuFill.read({ fresh: true }));
    const plan = await run(s.root, s.extP, 'application.plan', { url: read.url, fields: read.fields });
    const one = await page.evaluate((p) => globalThis.__shukatsuFill.act(p), plan);
    const next = await page.evaluate(() => globalThis.__shukatsuFill.again());
    assert.deepEqual(next.fields.map((f) => f.id), ['grad_year'], 'only the list that filled in late');
    const more = await run(s.root, s.extP, 'application.plan', { url: next.url, fields: next.fields });
    const two = await page.evaluate((p) => globalThis.__shukatsuFill.act({ ...p, resume: null }), more);
    const rows = [...one.rows, ...two.rows];
    const row = (id) => rows.findLast((r) => r.ref === [...read.fields, ...next.fields].find((f) => f.id === id).ref);

    const shown = (id) => page.$eval(`#${id}-value`, (el) => el.textContent);
    const sel = (id) => page.$eval(`#${id}`, (el) => el.options[el.selectedIndex].text);
    assert.equal(await shown('loc'), 'Boston, Massachusetts, United States', 'searched by city, and not Boston, England');
    assert.equal(await page.$eval('#loc', (el) => el.value), '', 'no search text left behind');
    assert.equal(await shown('degree'), 'Bachelor\'s Degree', 'picked from the open list, by level');
    assert.equal(await sel('grad_year'), '2028', 'a list that filled in once the degree was chosen');
    assert.equal(await sel('auth'), 'I am authorized to work in the U.S. for any employer');
    assert.equal(await sel('sponsor'), 'I will require sponsorship', 'the option without the "not"');
    assert.equal(row('sponsor').mark, 'check');
    assert.equal(await sel('canada'), 'Select...', 'never answered for Canada');
    assert.equal(row('canada').mark, 'yours');
    assert.equal(await shown('heard'), 'Career fair', 'from its own list');
    assert.equal(await page.evaluate(() => window.__decoy === true), false, 'never from another widget\'s list');
    assert.ok(two.rows.every((r) => r.state !== 'failed'), JSON.stringify(rows.filter((r) => r.state === 'failed')));
    assert.ok(one.ms + two.ms < 6000, `filled in ${one.ms + two.ms} ms`);
  } finally {
    await browser.close();
  }
});
