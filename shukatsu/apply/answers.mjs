/**
 * The candidate's stated answers (data/form-answers.yml), and the answers
 * suggested from their own fills.
 *
 * Stated answers are the candidate's words for what forms ask: the only
 * source for a sensitive question (apply/fields.mjs), and the answer to a
 * recurring question in its exact wording. Setting one is a stamp: only the
 * candidate, signed in, ever writes this file through shukatsu, and each
 * change is a commit in the data root's history.
 *
 * Suggestions come from the panel's "Remember my answers": what the
 * candidate typed or picked by hand on a form (a question Fill left to them,
 * a value they corrected). They wait in app.db until the candidate accepts
 * one, which states it, or dismisses it. A field's label is outside text, so
 * a suggestion is shown with the site it came from and is never used until
 * it is accepted.
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import * as yaml from 'js-yaml';
import { loadYaml } from '../../lib/yaml-document.mjs';
import { commitPaths } from '../core/git.mjs';
import { writeAtomic } from '../core/lock.mjs';
import { getSetting, now, setSetting } from '../core/store.mjs';
import { answersPath } from './bank.mjs';
import { KEYS, isSensitive, norm } from './fields.mjs';
import '../extension/match.js';

const { countriesIn, key: aliasKey } = globalThis.__shukatsuMatch;
const REL = join('data', 'form-answers.yml');
const SUGGESTIONS = 'fill.suggestions';
const MAX_SUGGESTIONS = 200;

/** The keys a candidate states per country. */
export const COUNTRY_KEYS = ['auth.work', 'auth.sponsorship'];
/** Keys never stated or suggested here: files and letters come from the packet, and a consent is read on each form. */
const NOT_STATED = new Set(['file.resume', 'file.cover', 'text.cover', 'consent']);
export const STATABLE = Object.keys(KEYS).filter((k) => !NOT_STATED.has(k));

const title = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

/** A country as the candidate wrote it ("US", "u.s.", "Japan"), as the name the matcher uses ("united states"). */
export const countryName = (c) => [...countriesIn(c)][0] || aliasKey(c);
/** How a country is written in the file and shown: "United States". */
export const countryLabel = (c) => title(countryName(c));

const empty = () => ({ answers: {}, questions: [] });

/** The file as stated: { answers: { key: text | { Country: text } }, questions: [{ q, a }] }. */
export function readAnswers(root) {
  const path = answersPath(root);
  if (!existsSync(path)) return empty();
  let doc;
  try { doc = loadYaml(readFileSync(path, 'utf-8')) || {}; } catch (e) { throw new Error(`data/form-answers.yml isn't valid YAML: ${e.message}`); }
  const answers = doc.answers && typeof doc.answers === 'object' ? doc.answers : {};
  const questions = (Array.isArray(doc.questions) ? doc.questions : []).filter((x) => x && x.q && x.a != null).map((x) => ({ q: String(x.q), a: String(x.a) }));
  return { answers, questions };
}

const HEADER = `# Your stated answers for application forms, read by shukatsu's Fill.
# Work authorization, sponsorship, salary, demographics: filled ONLY from here,
# never worked out from your profile. Edit on the Form answers page, or here.
# Work authorization and sponsorship go by country.
`;

function write(root, doc, message, actor) {
  const path = answersPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const out = { answers: doc.answers, questions: doc.questions };
  writeAtomic(path, `${HEADER}\n${yaml.dump(out, { lineWidth: 100, quotingType: '"', forceQuotes: false, noRefs: true })}`);
  return commitPaths(root, [REL], message, { author: actor, trailers: { Via: 'shukatsu form answers' } });
}

const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/**
 * State, change, or clear one answer. `target` is { key }, { key, country }
 * (work authorization and sponsorship), or { question }; an empty `value`
 * removes it. Returns { changed, commit }.
 */
export function setAnswer(root, target, value, { actor } = {}) {
  const doc = readAnswers(root);
  const v = clean(value);
  let what;
  if (target.question) {
    const q = clean(target.question);
    if (!q) throw Object.assign(new Error('A question needs its wording.'), { code: 'invalid_input', status: 400 });
    const n = norm(q);
    const rest = doc.questions.filter((x) => norm(x.q) !== n);
    doc.questions = v ? [...rest, { q, a: v }] : rest;
    what = `"${q.slice(0, 60)}"`;
  } else {
    const key = target.key;
    if (!STATABLE.includes(key)) throw Object.assign(new Error(`"${key}" isn't an answer this file holds.`), { code: 'invalid_input', status: 400 });
    if (COUNTRY_KEYS.includes(key) && target.country) {
      const name = countryName(target.country);
      const cur = doc.answers[key];
      if (cur != null && typeof cur !== 'object') {
        throw Object.assign(new Error(`${key} has an answer for no country in particular ("${cur}"). Clear it before stating one per country.`), { code: 'conflict', status: 409 });
      }
      const map = { ...(cur || {}) };
      for (const k of Object.keys(map)) if (countryName(k) === name) delete map[k];
      if (v) map[title(name)] = v;
      doc.answers[key] = Object.keys(map).length ? map : undefined;
      what = `${key} for ${title(name)}`;
    } else {
      if (COUNTRY_KEYS.includes(key) && doc.answers[key] && typeof doc.answers[key] === 'object' && v) {
        throw Object.assign(new Error(`${key} is stated per country; say which country.`), { code: 'invalid_input', status: 400 });
      }
      doc.answers[key] = v || undefined;
      what = key;
    }
    if (doc.answers[key] === undefined) delete doc.answers[key];
  }
  const before = existsSync(answersPath(root)) ? readFileSync(answersPath(root), 'utf-8') : null;
  const commit = write(root, doc, `form answers: ${v ? 'state' : 'clear'} ${what}`, actor);
  const after = readFileSync(answersPath(root), 'utf-8');
  return { changed: before !== after, commit };
}

// ---------------------------------------------------------------- suggestions

/** Where a typed answer would be stated: { key }, { key, country }, { question }, or null when it isn't one to keep. */
export function targetFor({ label, key }) {
  if (key && NOT_STATED.has(key)) return null;
  if (key && COUNTRY_KEYS.includes(key)) {
    const named = [...countriesIn(label || '')];
    if (named.length > 1) return null;
    return named.length ? { key, country: title(named[0]) } : { key };
  }
  if (key && KEYS[key]) return { key };
  const q = clean(label).replace(/\s*[*✱]+\s*$|\s*\((required|optional)\)\s*$/i, '');
  return q.length >= 3 && q.length <= 300 ? { question: q } : null;
}

const sameTarget = (a, b) => (a.question ? Boolean(b.question) && norm(a.question) === norm(b.question)
  : a.key === b.key && (a.country ? Boolean(b.country) && countryName(a.country) === countryName(b.country) : !b.country));

/** What is stated for a target now, or null. */
function statedFor(doc, t) {
  if (t.question) return doc.questions.find((x) => norm(x.q) === norm(t.question))?.a ?? null;
  const cur = doc.answers[t.key];
  if (t.country) return cur && typeof cur === 'object' ? Object.entries(cur).find(([c]) => countryName(c) === countryName(t.country))?.[1] ?? null : null;
  return cur && typeof cur !== 'object' ? String(cur) : null;
}

export const listSuggestions = (root) => getSetting(root, SUGGESTIONS, []);

/**
 * Keep what the candidate typed on a form as suggestions. `items` are
 * { label, key, value } from the panel; one already stated as is, or not an
 * answer to keep (a consent, a file, a long essay), is dropped. A newer
 * suggestion for the same question replaces the older. Returns { kept }.
 */
export function suggest(root, { url, items }) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const doc = readAnswers(root);
  let list = listSuggestions(root);
  let next = list.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  let kept = 0;
  for (const it of items) {
    const value = clean(it.value);
    if (!value || value.length > 300) continue;
    const target = targetFor(it);
    if (!target) continue;
    if (statedFor(doc, target) === value) continue;
    list = list.filter((s) => !sameTarget(s.target, target));
    list.push({ id: next++, target, value, label: clean(it.label).slice(0, 300), host, sensitive: Boolean(target.key && isSensitive(target.key)), at: now() });
    kept++;
  }
  setSetting(root, SUGGESTIONS, list.slice(-MAX_SUGGESTIONS));
  return { kept };
}

/** Drop a suggestion; returns it, or null when it is gone. */
export function takeSuggestion(root, id) {
  const list = listSuggestions(root);
  const hit = list.find((s) => s.id === id) || null;
  if (hit) setSetting(root, SUGGESTIONS, list.filter((s) => s.id !== id));
  return hit;
}
