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

const OPEN_ROW = new Set(['evaluated']);
const GENERIC_LABELS = new Set(['www', 'jobs', 'job', 'careers', 'career', 'boards', 'job-boards', 'apply', 'app', 'hire', 'recruiting', 'us', 'eu', 'emea', 'apac', 'secure', 'portal']);
const compact = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
const linksIn = (text) => (String(text || '').match(/https?:\/\/[^\s|)\]>]+/g) || []).map((l) => l.replace(/[.,;:!?'"]+$/, ''));

/**
 * The company an ATS address names: the tenant in the host
 * (bloomberg.avature.net, acme.wd1.myworkdayjobs.com, careers-acme.icims.com)
 * or in the path or query of a shared board (job-boards.greenhouse.io/acme,
 * jobs.lever.co/acme, ?for=acme, ?company=acme). Null off an ATS.
 */
export function tenantOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const p = platformOfUrl(url);
  if (!p || p.kind !== 'ats') return null;
  const base = p.hosts.find((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  const labels = u.hostname.slice(0, Math.max(0, u.hostname.length - base.length - 1)).split('.').filter(Boolean)
    .map((l) => l.replace(/^careers?-|-careers?$/g, '')).filter((l) => l && !GENERIC_LABELS.has(l) && !/^wd\d+$/.test(l));
  const query = u.searchParams.get('for') || u.searchParams.get('company');
  const path = u.pathname.split('/').filter(Boolean)[0];
  const t = query || labels[0] || (path && !['embed', 'en-us', 'en', 'job', 'jobs', 'careers'].includes(path.toLowerCase()) ? path : null);
  return t ? compact(t) : null;
}

const sameCompany = (tenant, company) => {
  const c = compact(company);
  if (!tenant || tenant.length < 4 || !c) return false;
  return tenant === c || c.startsWith(tenant) || tenant.startsWith(c);
};

/**
 * The posting a form belongs to: { posting, note }. By link first, the form's
 * address against a packet's or tracker row's link (the URL column, or any
 * link in the row's notes, where an "apply on Avature" link usually sits).
 * Then by company: an ATS address names its tenant, and one open packet or
 * one Evaluated row for that company is taken, marked so the panel says how
 * it was matched. Two or more are left unmatched, never guessed between.
 */
export function postingFor(root, url) {
  const key = applyKey(url);
  if (!key) return { posting: null, note: null };
  const packets = listPackets(root).filter((pk) => !['closed', 'sent'].includes(pk.status));
  const rows = readTracker(root).rows;
  const fromRow = (r, by) => ({ company: r.company, role: r.role, packet: packets.find((pk) => pk.tracker_num === Number(r.num)) || null, num: Number(r.num), pdf: r.pdf, by });
  const fromPacket = (pk, by) => {
    const r = pk.tracker_num ? rows.find((x) => Number(x.num) === pk.tracker_num) : null;
    return { company: pk.company, role: pk.role, packet: pk, num: r ? Number(r.num) : null, pdf: r?.pdf || null, by };
  };
  const pk = packets.find((x) => x.url && applyKey(x.url) === key);
  if (pk) return { posting: fromPacket(pk, 'link'), note: null };
  const row = rows.find((r) => [r.url, ...linksIn(r.notes)].some((l) => l && applyKey(l) === key));
  if (row) return { posting: fromRow(row, 'link'), note: null };

  const tenant = tenantOf(url);
  if (!tenant) return { posting: null, note: null };
  const byPacket = packets.filter((x) => sameCompany(tenant, x.company));
  const byRow = rows.filter((r) => OPEN_ROW.has(String(r.status).toLowerCase()) && sameCompany(tenant, r.company) && !byPacket.some((x) => x.tracker_num === Number(r.num)));
  const found = [...byPacket.map((x) => fromPacket(x, 'company')), ...byRow.map((r) => fromRow(r, 'company'))];
  if (found.length === 1) return { posting: found[0], note: null };
  if (found.length > 1) return { posting: null, note: `${found.length} open postings at ${found[0].company} (${found.map((f) => f.role).slice(0, 3).join('; ')}), so this form is matched to none of them.` };
  return { posting: null, note: null };
}

/**
 * The resume for a posting: { path, rel, name, date, by } or { tied: [names] } or null.
 * The tracker row's PDF column first, since it names the file made for this
 * posting. Otherwise the newest data/pdf-index.tsv CV with the company in its
 * name; two from the same newest day (a variant beside the main one) are
 * left to the candidate.
 */
export function resumeFor(root, posting) {
  if (!posting?.company) return null;
  const pdf = String(posting.pdf || '').trim();
  if (/\.pdf$/i.test(pdf) && existsSync(join(root, pdf))) return { path: join(root, pdf), rel: pdf, name: pdf.split('/').pop(), date: null, by: 'tracker' };
  const index = join(root, 'data', 'pdf-index.tsv');
  if (!existsSync(index)) return null;
  const want = slug(posting.company);
  const rows = readFileSync(index, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'))
    .filter((f) => f[1] && (f[5] || 'cv').trim() === 'cv' && f[1].toLowerCase().includes(want) && existsSync(join(root, f[1])))
    .sort((a, b) => String(b[4] || '').localeCompare(String(a[4] || '')));
  if (!rows.length) return null;
  const newest = rows.filter((f) => String(f[4] || '') === String(rows[0][4] || ''));
  if (newest.length > 1) return { tied: newest.map((f) => f[1].split('/').pop()) };
  return { path: join(root, rows[0][1]), rel: rows[0][1], name: rows[0][1].split('/').pop(), date: rows[0][4] || null, by: 'index' };
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
  const { posting, note: postingNote } = postingFor(root, url);
  const packet = posting?.packet || null;
  const reviewed = packet && ['ready', 'sent'].includes(packet.status);
  const found = resumeFor(root, posting);
  const resume = found?.path ? found : null;

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
      if (found?.tied) return { ...base, key: id.key, by: id.by, mark: 'yours', note: `${found.tied.length} resumes for ${posting.company} from the same day (${found.tied.join(', ')}); put the one you want in the tracker row's PDF column, or attach it yourself.` };
      if (!resume) return { ...base, key: id.key, by: id.by, mark: 'yours', note: posting ? `No resume PDF for ${posting.company} yet.` : 'shukatsu doesn\'t know this posting, so it can\'t pick a resume.' };
      return { ...base, key: id.key, by: id.by, act: 'file', value: resume.name, source: 'packet', mark: 'check', note: `${resume.name}${resume.by === 'tracker' ? ', the one the tracker row names' : resume.date ? `, made ${resume.date}` : ''}` };
    }
    if (id?.key === 'file.cover') return { ...base, key: id.key, by: id.by, mark: f.required ? 'yours' : 'empty', note: 'Attach a cover letter yourself if you want one here.' };
    if (id?.key === 'text.cover') {
      if (!packet?.cover_letter) return { ...empty(), key: id.key, by: id.by };
      return put(packet.cover_letter, 'packet', { key: id.key, by: id.by, check: !reviewed, note: reviewed ? null : 'From a packet not marked ready yet.' });
    }
    if (id) {
      let v = bank.values.get(id.key);
      if (isSensitive(id.key) && v?.source !== 'stated') {
        return { ...base, key: id.key, by: id.by, mark: 'yours', note: 'Answered only from what you state on Form answers.' };
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
          const why = asked.length > 1 ? `names ${asked.length} countries` : asked.length ? `asks about ${title(asked[0])}, which your Form answers don't list` : 'doesn\'t say which country';
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
    posting: posting ? { company: posting.company, role: posting.role, packet: packet?.id ?? null, status: packet?.status ?? null, num: posting.num ?? null, by: posting.by } : null,
    note: postingNote,
    resume: resume && entries.some((e) => e.act === 'file') && statSync(resume.path).size <= RESUME_MAX
      ? { name: resume.name, type: 'application/pdf', data: readFileSync(resume.path).toString('base64') } : null,
    entries,
  };
}
