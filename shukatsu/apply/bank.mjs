/**
 * The answer bank: every value a form can be filled with, each carrying where
 * it came from.
 *
 *   profile  data/career-profile.yml `candidate` and `education` (the master profile)
 *   config   config/profile.yml `candidate`, for what the master profile leaves out
 *   stated   data/form-answers.yml: what the candidate has said for forms in so
 *            many words. The only source for a sensitive key (apply/fields.mjs),
 *            and the source for a question asked in exactly those words.
 *
 * data/form-answers.yml is user data (DATA_CONTRACT.md) and shaped like:
 *
 *   answers:                 # by answer key
 *     auth.work:             # by country: a question about another country stays yours
 *       United States: "Yes"
 *       Japan: "Yes"
 *     auth.sponsorship:
 *       United States: "Yes"
 *     eeo.gender: "Decline to self-identify"
 *   questions:               # by the question's own wording
 *     - q: "Are you enrolled in a co-op program?"
 *       a: "Yes"
 *
 * Work authorization and sponsorship are answered per country, since they
 * differ by country; a plain answer for either is taken for a question that
 * names no country, and never for one that names a country.
 *
 * Nothing here is invented. A link without a scheme gets https:// so a url
 * field takes it, and a two-word name splits into given and family (marked
 * for a look); everything else is the stored value as written.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadYaml } from '../../lib/yaml-document.mjs';
import { getProfilePath } from '../../path-resolver.mjs';
import { loadProfile } from '../core/facts.mjs';
import { norm } from './fields.mjs';
import '../extension/match.js';

/** A country as form-answers.yml spells it ("US", "United States", "U.S.A."), as the matcher names it. */
const countryName = (c) => [...globalThis.__shukatsuMatch.countriesIn(c)][0] || globalThis.__shukatsuMatch.key(c);

export const answersPath = (root) => join(root, 'data', 'form-answers.yml');

const readYaml = (path) => {
  if (!existsSync(path)) return {};
  try { return loadYaml(readFileSync(path, 'utf-8')) || {}; } catch (e) { throw new Error(`${path} isn't valid YAML: ${e.message}`); }
};

const asText = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null ? '' : String(v).trim());
const link = (v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);

const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+((19|20)\d{2})\b/i;

/** The month and year an education entry ends, from its dates ("Sep 2024 – May 2028", "Expected Graduation: May 2028"): "May 2028", or the year alone. */
function endOf(dates) {
  const parts = String(dates || '').split(/\s*[–—]\s*|\s+-\s+|\s+to\s+/i);
  const last = parts[parts.length - 1] || '';
  const m = last.match(MONTH);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[m.length - 2]}`;
  return last.match(/\b(19|20)\d{2}\b/)?.[0] || '';
}

const COUNTRY_KEYS = new Set(['auth.work', 'auth.sponsorship']);

/**
 * { values: Map<key, {value, source, check}>, questions: [{q, a, n}] }.
 * `check` marks a value worth a glance (a split name, an education line).
 */
export function loadBank(root) {
  const values = new Map();
  const put = (key, value, source, check = false) => {
    const v = asText(value);
    if (v && !values.has(key)) values.set(key, { value: v, source, check });
  };
  const stated = readYaml(answersPath(root));
  for (const [key, value] of Object.entries(stated.answers || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!COUNTRY_KEYS.has(key)) continue;
      const byCountry = new Map(Object.entries(value).map(([c, a]) => [countryName(c), asText(a)]).filter(([c, a]) => c && a));
      if (byCountry.size) values.set(key, { value: null, byCountry, source: 'stated', check: false });
    } else if (COUNTRY_KEYS.has(key)) {
      const a = asText(value);
      if (a) values.set(key, { value: a, byCountry: new Map([['', a]]), source: 'stated', check: false });
    } else put(key, value, 'stated');
  }

  let p = {};
  try { p = loadProfile(root); } catch { /* no master profile yet: config and stated answers still count */ }
  const c = p.candidate || {};
  const cfg = readYaml(getProfilePath(root)).candidate || {};
  const full = asText(c.name || cfg.full_name);
  put('name.full', full, c.name ? 'profile' : 'config');
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    put('name.given', words[0], 'profile', words.length > 2);
    put('name.family', words[words.length - 1], 'profile', words.length > 2);
  }
  for (const [key, a, b] of [['email', c.email, cfg.email], ['phone', c.phone, cfg.phone]]) put(key, a || b, a ? 'profile' : 'config');
  // "Boston, MA / Tokyo, Japan" is two places; a location box takes one, so the first, marked for a look.
  const places = asText(c.location || cfg.location).split(/\s+\/\s+|\s*;\s*|\s+or\s+/).filter(Boolean);
  put('location', places[0], c.location ? 'profile' : 'config', places.length > 1);
  for (const [key, a, b] of [['link.linkedin', c.linkedin, cfg.linkedin], ['link.github', c.github, cfg.github], ['link.portfolio', c.portfolio_url || c.portfolio, cfg.portfolio_url]]) put(key, link(asText(a || b)), a ? 'profile' : 'config');

  const school = (p.education || []).find((e) => e.status !== 'retired') || null;
  if (school) {
    // The heading carries the place ("Northeastern University -- Boston, MA"); a form asks for the school.
    put('school', school.label || String(school.heading || '').split(/\s+(?:--|—|–|\|)\s+/)[0], 'profile', true);
    put('degree', String(school.title || '').replace(/^(candidate for|pursuing|expected)\s+(an?\s+)?/i, ''), 'profile', true);
    put('grad.date', endOf(school.dates), 'profile', true);
  }

  const questions = (Array.isArray(stated.questions) ? stated.questions : [])
    .map((x) => ({ q: String(x?.q || '').trim(), a: asText(x?.a) })).filter((x) => x.q && x.a).map((x) => ({ ...x, n: norm(x.q) }));
  return { values, questions };
}
