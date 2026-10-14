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
 *     auth.work: "Yes"
 *     auth.sponsorship: "Yes"
 *     eeo.gender: "Decline to self-identify"
 *   questions:               # by the question's own wording
 *     - q: "Are you enrolled in a co-op program?"
 *       a: "Yes"
 *
 * Nothing here is invented. A link without a scheme gets https:// so a url
 * field takes it, and a two-word name splits into given and family (marked
 * for a look); everything else is the stored value as written.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { loadProfile } from '../core/facts.mjs';
import { norm } from './fields.mjs';

export const answersPath = (root) => join(root, 'data', 'form-answers.yml');

const readYaml = (path) => {
  if (!existsSync(path)) return {};
  try { return yaml.load(readFileSync(path, 'utf-8')) || {}; } catch (e) { throw new Error(`${path} isn't valid YAML: ${e.message}`); }
};

const asText = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null ? '' : String(v).trim());
const link = (v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);

/** The year and month an education entry ends, from its dates ("Sep 2024 – May 2028"). */
function endOf(dates) {
  const parts = String(dates || '').split(/\s*[–—-]\s*|\s+to\s+/i);
  return (parts[parts.length - 1] || '').replace(/\(expected\)|expected/i, '').trim();
}

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
  for (const [key, value] of Object.entries(stated.answers || {})) put(key, value, 'stated');

  let p = {};
  try { p = loadProfile(root); } catch { /* no master profile yet: config and stated answers still count */ }
  const c = p.candidate || {};
  const cfg = readYaml(join(root, 'config', 'profile.yml')).candidate || {};
  const full = asText(c.name || cfg.full_name);
  put('name.full', full, c.name ? 'profile' : 'config');
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    put('name.given', words[0], 'profile', words.length > 2);
    put('name.family', words[words.length - 1], 'profile', words.length > 2);
  }
  for (const [key, a, b] of [['email', c.email, cfg.email], ['phone', c.phone, cfg.phone], ['location', c.location, cfg.location]]) put(key, a || b, a ? 'profile' : 'config');
  for (const [key, a, b] of [['link.linkedin', c.linkedin, cfg.linkedin], ['link.github', c.github, cfg.github], ['link.portfolio', c.portfolio_url || c.portfolio, cfg.portfolio_url]]) put(key, link(asText(a || b)), a ? 'profile' : 'config');

  const school = (p.education || []).find((e) => e.status !== 'retired') || null;
  if (school) {
    put('school', school.heading || school.label, 'profile', true);
    put('degree', school.title, 'profile', true);
    put('grad.date', endOf(school.dates), 'profile', true);
  }

  const questions = (Array.isArray(stated.questions) ? stated.questions : [])
    .map((x) => ({ q: String(x?.q || '').trim(), a: asText(x?.a) })).filter((x) => x.q && x.a).map((x) => ({ ...x, n: norm(x.q) }));
  return { values, questions };
}
