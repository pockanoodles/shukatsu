/**
 * A fill plan: for every field the extension read off an application form,
 * what goes in it, where that came from, and how sure it is.
 *
 * The model reads, code acts: nothing here clicks, and nothing here calls a
 * model. A plan is built from the answer bank (apply/bank.mjs), the posting's
 * packet (its tailored resume, cover letter, and reviewed answers), and the
 * ATS's own field names (platforms/), so a form on a known ATS is planned in
 * milliseconds and filled by the extension in one pass.
 *
 * Each entry's `mark` is what the candidate sees beside the field:
 *   sure   filled from an exact source; no need to look
 *   check  filled, worth a glance (a fuzzy option, a split name, a draft answer)
 *   yours  left for the candidate: a sensitive question never stated, a
 *          required field nothing answers, a box the site won't let a script tick
 *   empty  optional and unanswered, left alone
 *   skip   not filled on purpose: hidden (a bot trap), or a kind we never touch
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { platformOfUrl } from '../platforms/index.mjs';
import { similarity, slug } from '../core/facts.mjs';
import { listPackets } from '../core/packets.mjs';
import { readTracker } from '../core/tracker.mjs';
import { normalizeUrl } from '../../url-key.mjs';
import { loadBank } from './bank.mjs';
import { identify, isSensitive, norm } from './fields.mjs';
import '../extension/match.js'; // one option matcher for the server and the page; it defines globalThis.__shukatsuMatch

const { choose, countriesIn } = globalThis.__shukatsuMatch;

export const FIELD_KINDS = ['text', 'email', 'tel', 'url', 'number', 'search', 'textarea', 'select', 'combobox', 'radio', 'checkbox', 'date', 'month', 'file'];
const RESUME_MAX = 5 * 1024 * 1024;

/**
 * One posting, spelled the way its application form is: the ATS and the path
 * without /apply, /application, or the fragment, so the posting link and the
 * form it hands over to compare equal. A Greenhouse embed carries the job in
 * its query (?for=acme&token=4001).
 */
export function applyKey(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const p = platformOfUrl(url);
  if (p?.id === 'greenhouse' && u.searchParams.get('token')) return `greenhouse:/${u.searchParams.get('for') || ''}/jobs/${u.searchParams.get('token')}`;
  const path = u.pathname.replace(/\/(apply|application)\/?$/i, '').replace(/\/+$/, '');
  if (p) return `${p.id}:${path.toLowerCase()}`;
  const n = normalizeUrl(`${u.origin}${path}`);
  return n || null;
}

/** The packet or tracker row for the posting a form belongs to, if shukatsu knows it. */
export function postingFor(root, url) {
  const key = applyKey(url);
  if (!key) return null;
  const packet = listPackets(root).find((pk) => pk.url && pk.status !== 'closed' && applyKey(pk.url) === key) || null;
  if (packet) return { company: packet.company, role: packet.role, packet };
  const row = readTracker(root).rows.find((r) => r.url && applyKey(r.url) === key);
  return row ? { company: row.company, role: row.role, packet: null, num: row.num } : null;
}

/**
 * The newest resume PDF generate-pdf.mjs wrote for this company
 * (data/pdf-index.tsv), as { path, name, date }. Matched by the company in
 * the file name, so it is always shown to the candidate, never assumed.
 */
export function resumeFor(root, company) {
  const index = join(root, 'data', 'pdf-index.tsv');
  if (!company || !existsSync(index)) return null;
  const want = slug(company);
  const rows = readFileSync(index, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'))
    .filter((f) => f[1] && (f[5] || 'cv').trim() === 'cv' && f[1].toLowerCase().includes(want) && existsSync(join(root, f[1])))
    .sort((a, b) => String(b[4] || '').localeCompare(String(a[4] || '')));
  if (!rows.length) return null;
  const path = join(root, rows[0][1]);
  return { path, rel: rows[0][1], name: rows[0][1].split('/').pop(), date: rows[0][4] || null };
}

const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "May 2028" as a month input takes it, "2028-05"; null without both a month and a year. */
function monthValue(text) {
  const t = String(text).toLowerCase();
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const year = t.match(/\b(19|20)\d{2}\b/)?.[0];
  const m = MONTHS.findIndex((x) => new RegExp(`\\b${x}`).test(t));
  return year && m >= 0 ? `${year}-${String(m + 1).padStart(2, '0')}` : null;
}

/** The packet's written answer closest to a question, when one is close enough to be the same question. */
function answerFor(packet, label) {
  let answers = [];
  try { answers = JSON.parse(packet?.answers || '[]'); } catch { answers = []; }
  const best = answers.filter((a) => a.text).map((a) => ({ a, s: similarity(label, a.question) })).sort((x, y) => y.s - x.s)[0];
  return best && best.s >= 0.5 ? best.a : null;
}

/**
 * Plan a form. `fields` is what the extension read (extension/filler.js
 * `read`): each with ref, kind, label, name, id, autocomplete, placeholder,
 * required, maxlength, options, visible.
 * Returns { platform, posting, resume, entries }.
 */
export function planForm(root, { url, fields }) {
  const p = platformOfUrl(url);
  const vendor = p?.fill || null;
  const bank = loadBank(root);
  const posting = postingFor(root, url);
  const packet = posting?.packet || null;
  const reviewed = packet && ['ready', 'sent'].includes(packet.status);
  const resume = posting ? resumeFor(root, posting.company) : null;

  const entries = fields.map((f) => {
    const base = { ref: f.ref, key: null, by: null, act: 'leave', value: null, option: null, source: null, note: null };
    const empty = () => ({ ...base, mark: f.required ? 'yours' : 'empty', note: f.required ? 'Nothing on file answers this.' : null });
    if (!FIELD_KINDS.includes(f.kind)) return { ...base, mark: 'skip' };
    // A field the candidate can't see is a bot trap as often as not, and filling one marks the application as a bot's.
    if (!f.visible && f.kind !== 'file') return { ...base, mark: 'skip', note: 'Hidden on the page, so left alone.' };

    const put = (value, source, { key = null, by = null, check = false, note = null } = {}) => {
      const out = { ...base, key, by, source, note };
      if (['select', 'radio', 'combobox'].includes(f.kind) || (f.kind === 'checkbox' && f.options?.length)) {
        if (!f.options?.length) return { ...out, act: 'choose', value, mark: 'check', note: note || 'Picked from the list once it opens.' };
        const hit = choose(f.options, value);
        if (!hit) return { ...out, value, mark: 'yours', note: `No option reads like "${value}".` };
        if (hit.index < 0) return { ...out, value, mark: 'yours', note: `More than one option fits "${value}": ${hit.tied.slice(0, 3).map((i) => f.options[i].text).join(' / ')}.` };
        const tick = f.kind === 'radio' || f.kind === 'checkbox';
        if (tick && vendor && vendor.clicks === false) return { ...out, value: f.options[hit.index].text, option: hit.index, mark: 'yours', note: `Tick "${f.options[hit.index].text}" yourself: this site's captcha trips on a scripted click.` };
        return { ...out, act: 'choose', value: f.options[hit.index].text, option: hit.index, mark: check || hit.fuzzy ? 'check' : 'sure' };
      }
      if (f.kind === 'checkbox') return { ...out, value, mark: 'yours', note: note || 'A box to tick yourself.' };
      if (f.kind === 'month') {
        const ym = monthValue(value);
        if (!ym) return { ...out, value, mark: 'yours', note: `"${value}" isn't a month and year.` };
        value = ym;
      }
      if (f.kind === 'date') return { ...out, value, mark: 'yours', note: `Wants a full date; on file: ${value}.` };
      const over = f.maxlength && value.length > f.maxlength;
      return { ...out, act: 'type', value, mark: over || check ? 'check' : 'sure', note: over ? `${value.length} characters, and the box takes ${f.maxlength}.` : note };
    };

    // His own words for exactly this question come first.
    const n = norm(f.label);
    const said = n && bank.questions.find((x) => x.n === n);
    if (said) return put(said.a, 'stated');

    const id = identify(f, vendor);
    if (id?.key === 'file.resume') {
      if (!resume) return { ...base, key: id.key, by: id.by, mark: 'yours', note: posting ? `No resume PDF for ${posting.company} yet.` : 'shukatsu doesn\'t know this posting, so it can\'t pick a resume.' };
      return { ...base, key: id.key, by: id.by, act: 'file', value: resume.name, source: 'packet', mark: 'check', note: `${resume.name}${resume.date ? `, made ${resume.date}` : ''}` };
    }
    if (id?.key === 'file.cover') return { ...base, key: id.key, by: id.by, mark: f.required ? 'yours' : 'empty', note: 'Attach a cover letter yourself if you want one here.' };
    if (id?.key === 'text.cover') {
      if (!packet?.cover_letter) return { ...empty(), key: id.key, by: id.by };
      return put(packet.cover_letter, 'packet', { key: id.key, by: id.by, check: !reviewed, note: reviewed ? null : 'From a packet not marked ready yet.' });
    }
    if (id) {
      let v = bank.values.get(id.key);
      if (isSensitive(id.key) && v?.source !== 'stated') {
        return { ...base, key: id.key, by: id.by, mark: 'yours', note: 'Answered only from what you have stated (data/form-answers.yml).' };
      }
      // Work authorization is a different answer in every country, so it is used only for the country the question
      // names; a question that names none takes a plain answer, or the one country listed, shown for a look.
      let only = null;
      if (v?.byCountry) {
        const asked = [...countriesIn(f.label)];
        const listed = [...v.byCountry.keys()].filter(Boolean);
        if (!asked.length && !v.byCountry.has('') && listed.length === 1) only = listed[0];
        const said = asked.length === 1 ? v.byCountry.get(asked[0]) : asked.length ? null : v.byCountry.get('') ?? (only && v.byCountry.get(only));
        if (!said) {
          const why = asked.length > 1 ? `names ${asked.length} countries` : asked.length ? `asks about ${title(asked[0])}, which form-answers.yml doesn't list under ${id.key}` : 'doesn\'t say which country';
          return { ...base, key: id.key, by: id.by, mark: 'yours', note: `This question ${why}.` };
        }
        v = { ...v, value: said };
      }
      if (only) return put(v.value, v.source, { key: id.key, by: id.by, check: true, note: `Your answer for ${title(only)}; the question doesn't name a country.` });
      if (v) return put(v.value, v.source, { key: id.key, by: id.by, check: v.check || id.confidence < 0.8 });
      return { ...empty(), key: id.key, by: id.by };
    }
    if (['textarea', 'text'].includes(f.kind) && f.label && f.label.length >= 15) {
      const a = answerFor(packet, f.label);
      if (a) return put(a.text, 'packet', { by: 'question', check: !reviewed, note: reviewed ? `Your answer to "${a.question}".` : `Draft answer to "${a.question}", not reviewed yet.` });
    }
    return empty();
  });

  return {
    platform: p ? { id: p.id, name: p.name, parser: vendor?.parser || null } : null,
    posting: posting ? { company: posting.company, role: posting.role, packet: packet?.id ?? null, status: packet?.status ?? null } : null,
    resume: resume && entries.some((e) => e.act === 'file') && statSync(resume.path).size <= RESUME_MAX
      ? { name: resume.name, type: 'application/pdf', data: readFileSync(resume.path).toString('base64') } : null,
    entries,
  };
}
