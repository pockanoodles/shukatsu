#!/usr/bin/env node

/**
 * master.mjs -- the master resume.
 *
 * One profile holds every achievement the candidate has ever had
 * ({DATA_ROOT}/data/career-profile.yml, career-ops Master Career Profile v1 plus
 * the fields listed in its header). Every resume is a selection from it:
 *
 *   cv.md          = render of every verified, active fact (`render --write`)
 *   tailored CV    = `select` (pick, order, choose a variant), which writes a draft
 *                    whose every bullet declares its fact (`<!-- fact:id -->`),
 *                    then light JD rewording, then `finalize`: each bullet is
 *                    checked against the fact it declares (live, same numbers,
 *                    still the same claim), the clean deliverable is written next
 *                    to the draft as `*.final.md`, the lint/verify/audit gates run
 *                    on it, and the manifest records the fact IDs sent.
 *
 * The manifests are what make a retired claim recallable: `used <fact-id>` lists
 * every application that received it. Drafts are reviewed with
 * `node shukatsu/review.mjs` (or the app's Review page).
 *
 *   node shukatsu/master.mjs validate
 *   node shukatsu/master.mjs pending
 *   node shukatsu/master.mjs render [--write] [--lang ja] [--manifest m.json] [--out f.md] [--tags]
 *   node shukatsu/master.mjs select --archetype A --company C --role R [--jd jds/x.md] [--num N]
 *   node shukatsu/master.mjs finalize <manifest.json> [--file draft.md|html]
 *   node shukatsu/master.mjs trace <resume.md|docx|html> [--save --company C --role R --date D --num N]
 *   node shukatsu/master.mjs sent <manifest.json> --on YYYY-MM-DD [--num N]
 *   node shukatsu/master.mjs used <fact-id> | --retired
 *   node shukatsu/master.mjs --self-test
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { readText } from './audit-materials.mjs';
import { isLive, isPending, loadProfile, numbers, quantities, sameNumbers, similarity, slug, today } from './core/facts.mjs';
import { render, withBanner } from './core/render.mjs';
import { select } from './core/select.mjs';
import { MATCH, WEAK, finalize, trace, traceProblem } from './core/trace.mjs';
import { upstreamValidate, validate } from './core/validate.mjs';
import { manifestDir, readManifests, sentIds } from './core/manifests.mjs';
import { trackerRows } from './core/tracker.mjs';

// The engine moved to core/. These re-exports keep older imports working.
export { isLive, loadProfile, numbers, similarity, render, select, trace, validate, finalize };

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}

const pickFrom = (m) => new Map(m.selection.map((s) => [s.entity, s.facts.map((f) => ({ id: f.id, variant: f.variant }))]));

function cli(argv) {
  const root = getCareerOpsRoot();
  const a = args(argv);
  const [cmd, target] = a._;
  if (a['self-test']) return selfTest();
  const p = loadProfile(root);

  if (cmd === 'validate') {
    const up = upstreamValidate(p._path);
    const { errors, warns } = validate(p, root);
    if (!up.ok) errors.unshift(`upstream schema: ${up.out}`);
    for (const w of warns) console.log(`warn   ${w}`);
    for (const e of errors) console.log(`ERROR  ${e}`);
    const live = [...p._facts.values()].filter((x) => isLive(x.fact)).length;
    console.log(`\n${p._facts.size} facts (${live} live), ${errors.length} errors, ${warns.length} warnings`);
    return errors.length ? 1 : 0;
  }

  if (cmd === 'pending') {
    let n = 0;
    for (const e of p._entities.filter(isPending)) { n++; console.log(`entity  ${e.id}: ${e.heading} | ${e.title || ''} | ${e.dates || ''}`); }
    for (const [id, { fact: f }] of p._facts) {
      if (isPending(f)) { n++; console.log(`fact    ${id}: ${f.text}`); }
      if (f.status && f.status !== 'active') continue;
      for (const v of (f.variants || []).filter(isPending)) { n++; console.log(`variant ${id}/${v.key} (for ${(v.for || []).join(', ')}): ${v.text}`); }
      if (f.ja?.text && isPending(f.ja)) { n++; console.log(`ja      ${id}: ${f.ja.text}`); }
    }
    console.log(`\n${n} items need review. Review them with: node shukatsu/review.mjs (or the app's Review page)`);
    return 0;
  }

  if (cmd === 'render') {
    let pick = null;
    let summaryId = null;
    if (a.manifest) {
      const m = JSON.parse(readFileSync(resolve(root, a.manifest), 'utf-8'));
      pick = pickFrom(m);
      summaryId = m.summary || null;
    }
    const { text, skipped } = render(p, { pick, lang: a.lang || 'en', summaryId, tags: Boolean(a.tags) });
    if (a.write) {
      writeFileSync(join(root, 'cv.md'), withBanner(text));
      console.log(`Wrote ${join(root, 'cv.md')}`);
    } else if (a.out) writeFileSync(resolve(root, a.out), text);
    else process.stdout.write(text);
    if (skipped.length) console.error(`${skipped.length} facts have no verified ${a.lang} text and were left out: ${skipped.join(', ')}`);
    return 0;
  }

  if (cmd === 'select') {
    if (!a.archetype || !a.company || !a.role) throw new Error('select needs --archetype, --company, and --role');
    const jdText = a.jd ? readFileSync(resolve(root, a.jd), 'utf-8') : '';
    const s = select(p, { archetype: a.archetype, jdText });
    const name = `${today()}-${slug(a.company)}-${slug(a.role)}`;
    // "-cv" makes audit-materials classify it as a resume, so the must-carry rules apply.
    const out = join('output', 'tailored', `${name}-cv.md`);
    mkdirSync(join(root, 'output', 'tailored'), { recursive: true });
    mkdirSync(manifestDir(root), { recursive: true });
    writeFileSync(join(root, out), render(p, { pick: s.pick, summaryId: s.summaryId, tags: true }).text);
    const manifest = {
      schema: 1, created: today(), company: a.company, role: a.role, num: a.num ? String(a.num) : null,
      archetype: a.archetype, jd: a.jd || null, lang: 'en', summary: s.summaryId,
      selection: s.manifest, output: out, status: 'draft', final: [],
    };
    const mPath = join(manifestDir(root), `${name}.json`);
    writeFileSync(mPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const sec of s.manifest) {
      console.log(sec.entity);
      for (const f of sec.facts) console.log(`  ${String(f.score).padStart(6)}  ${f.id}${f.variant ? ` [${f.variant}]` : ''}  ${f.why}`);
    }
    console.log('left out:');
    for (const f of s.left) console.log(`  ${String(f.score).padStart(6)}  ${f.id}  ${f.why}`);
    console.log(`\ndraft     ${out}\nmanifest  ${relative(root, mPath)}\nNext: reword toward the JD per modes/shukatsu/bullets.md (keep each <!-- fact:id --> tag), then finalize.`);
    return 0;
  }

  if (cmd === 'finalize') {
    if (!target) throw new Error('finalize needs a manifest path');
    const r = finalize(p, root, resolve(root, target), a.file);
    for (const x of r.problems) console.log(`TRACE  ${x}`);
    for (const row of r.rows.filter((x) => x.kind === 'reworded')) console.log(`note   line ${row.line}: reworded from ${row.id} (similarity ${row.score}). Check it still says the same thing.`);
    for (const g of r.gates) console.log(`${g.ok ? 'pass' : 'FAIL'}   ${g.name}${g.ok ? '' : `\n${g.out.split('\n').slice(-12).join('\n')}`}`);
    console.log(r.ok ? `\nFinal: ${r.deliverable}. Manifest records every fact this resume sends.` : '\nNot final. Fix the above and rerun.');
    return r.ok ? 0 : 1;
  }

  if (cmd === 'trace') {
    if (!target) throw new Error('trace needs a file');
    const path = resolve(root, target);
    const rows = trace(p, readText(path), path);
    for (const r of rows) {
      const flag = r.kind === 'unmatched' ? 'NONE ' : r.retired ? 'RETIRED' : r.kind === 'weak' ? 'weak ' : r.numbersOk ? 'ok   ' : 'NUM≠ ';
      console.log(`${flag}  ${String(r.score).padEnd(4)} ${(r.id || '-').padEnd(34)} ${r.text.slice(0, 90)}`);
    }
    const c = (k) => rows.filter(k).length;
    console.log(`\n${c((r) => r.kind === 'match')} matched, ${c((r) => r.retired)} retired, ${c((r) => r.kind === 'match' && !r.numbersOk)} with changed numbers, ${c((r) => r.kind === 'weak')} weak, ${c((r) => r.kind === 'unmatched')} unmatched`);
    if (a.save) {
      if (!a.company) throw new Error('trace --save needs --company');
      mkdirSync(manifestDir(root), { recursive: true });
      const name = `${a.date || today()}-${slug(a.company)}-${slug(a.role || 'role')}`;
      const m = {
        schema: 1, created: today(), company: a.company, role: a.role || null, num: a.num ? String(a.num) : null,
        sent_on: a.date || null, traced: true, output: relative(root, path), status: 'sent-before-master',
        final: rows.filter((r) => r.kind === 'match').map((r) => ({ id: r.id, form: r.form, score: r.score, text: r.text })),
      };
      writeFileSync(join(manifestDir(root), `${name}.json`), `${JSON.stringify(m, null, 2)}\n`);
      console.log(`saved data/manifests/${name}.json`);
    }
    return 0;
  }

  if (cmd === 'sent') {
    if (!target || !a.on) throw new Error('sent needs a manifest path and --on YYYY-MM-DD');
    const mPath = resolve(root, target);
    const m = JSON.parse(readFileSync(mPath, 'utf-8'));
    if (m.status !== 'final') throw new Error(`${target} is ${m.status}, not final. Run finalize first.`);
    m.sent_on = a.on;
    if (a.num) m.num = String(a.num);
    writeFileSync(mPath, `${JSON.stringify(m, null, 2)}\n`);
    console.log(`${m.company} | ${m.role} marked sent on ${a.on}`);
    return 0;
  }

  if (cmd === 'used') {
    const tracker = trackerRows(root);
    const want = a.retired ? (id) => p._facts.has(id) && !isLive(p._facts.get(id).fact) && p._facts.get(id).fact.status === 'retired' : (id) => id === target;
    if (!a.retired && !target) throw new Error('used needs a fact id, or --retired');
    let n = 0;
    for (const m of readManifests(root)) {
      const hit = [...new Set(sentIds(m).filter(want))];
      if (!hit.length) continue;
      n++;
      const t = m.num ? tracker.get(m.num) : null;
      const when = m.sent_on || `${m.created} (not sent)`;
      console.log(`${when.padEnd(10)}  ${m.company} | ${m.role || '-'}${m.num ? ` | #${m.num}` : ''}${t ? ` | ${t.status}` : ''}  ->  ${hit.join(', ')}`);
    }
    console.log(`\n${n} application${n === 1 ? '' : 's'}`);
    return 0;
  }

  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
  return cmd ? 1 : 0;
}

// ---------------------------------------------------------------- self-test

function selfTest() {
  const assert = (c, m) => { if (!c) { console.error(`FAIL ${m}`); process.exitCode = 1; } else console.log(`ok   ${m}`); };
  assert(JSON.stringify(numbers('from 30 to 350 (3.5×, ~4,000 calls)')) === JSON.stringify(['30', '3.5', '350', '4000'].sort()), 'numbers normalizes commas and sorts');
  assert(sameNumbers('69 of 314 (22%)', '22% of 314, 69 cut'), 'number sets compare regardless of order');
  assert(!sameNumbers('32.5% vs 3.7%', '32% vs 6%'), 'changed numbers are caught');
  assert(sameNumbers('raised ~¥2M through campaigns', '約200万円の寄付を調達'), 'one amount written two ways compares equal (2M = 200万)');
  assert(!sameNumbers('cut a 45 minutes crawl', 'cut a 45M crawl'), 'a unit letter counts only as a whole token');
  assert(JSON.stringify(quantities('$8.47 vs $35.97 per 1,000 tasks')) === JSON.stringify(['1000', '35.97', '8.47']), 'quantities parse money and thousands');
  assert(similarity('Minor in Computer Science, Concentration in MIS', 'Minor in Computer Science') >= MATCH, 'a short fact inside a longer line matches');
  assert(similarity('Built a Tableau dashboard for leadership', 'Scaled outbound dials from 30 to 350') < WEAK, 'unrelated lines do not match');
  assert(similarity('ダイヤラーの移行を推進し架電数を拡大', 'ダイヤラーと業務ツールの移行2件を自ら要件定義・推進し、架電試行数を拡大') > WEAK, 'Japanese uses character bigrams');
  const loaded = loadProfile('/nonexistent', JSON.stringify({
    candidate: { name: 'T' }, layout: [{ section: 'work', heading: 'Work' }], archetypes: { a: { tags: ['x'] } }, select: { max_bullets: 2 },
    experiences: [{ id: 'e', heading: 'E', facts: [
      { id: 'e.one', text: 'Cut cost 10% on 5 runs', tags: ['x'], review_status: 'verified' },
      { id: 'e.two', text: 'Wrote 3 docs', review_status: 'verified' },
      { id: 'e.old', text: 'Old 9 claim', status: 'retired', review_status: 'verified' },
      { id: 'e.no', text: 'Rejected 4 claim', status: 'rejected', review_status: 'needs_review' },
      { id: 'e.idk', text: 'Unsure 6 claim', status: 'cannot-confirm', review_status: 'needs_review' },
      { id: 'e.new', text: 'Draft 7 claim', review_status: 'needs_review' }] }],
  }));
  const full = render(loaded).text;
  assert(full.includes('Cut cost') && !/Old 9|Draft 7|Rejected 4|Unsure 6/.test(full), 'render shows live facts only');
  const s = select(loaded, { archetype: 'a' });
  assert(s.manifest[0].facts[0].id === 'e.one', 'select ranks the tag match first');
  assert(select(loaded, { archetype: 'a', force: ['e.two'], drop: ['e.one'] }).manifest[0].facts.map((f) => f.id).join() === 'e.two', 'force and drop override the ranking inside the budget');
  const tagged = render(loaded, { tags: true }).text;
  assert(tagged.includes('- Cut cost 10% on 5 runs <!-- fact:e.one -->'), 'tagged render declares each bullet\'s fact');
  const rows = trace(loaded, '## Work Experience\n### E\n- Reduced cost by 10% across 5 runs <!-- fact:e.one -->\n- Reduced cost by 12% across 5 runs <!-- fact:e.one -->\n- Wrote 3 docs <!-- fact:e.old -->\n', 'x.md', { bullets: true });
  assert(rows[0].declared && rows[0].numbersOk && !traceProblem(rows[0]), 'a declared rewording with the same numbers passes');
  assert(/numbers changed/.test(traceProblem(rows[1]) || ''), 'a declared rewording that changes a number fails');
  assert(/no longer active/.test(traceProblem(rows[2]) || ''), 'declaring a retired fact fails');
  return process.exitCode || 0;
}

if (isMainModule(import.meta.url)) {
  try { process.exitCode = cli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
