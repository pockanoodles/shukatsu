/**
 * The master profile as a fact model: loading, statuses, the wordings a fact is
 * written in, and the text tools every gate shares (numbers, similarity).
 *
 * {DATA_ROOT}/data/career-profile.yml holds every achievement as one fact. A
 * fact counts (is "live") only while it is active and verified. Everything else
 * is a draft, a decision, or history, and is never sent to an employer.
 *
 * Fact statuses (`status`, fork field, upstream ignores it):
 *   active          the default. Counts once review_status is verified.
 *   retired         was true or was sent, no longer used. Needs retired_on + reason.
 *   rejected        a draft the candidate turned down in review. Needs decided_on + decision_note.
 *   cannot-confirm  the candidate couldn't confirm it. Durable: it never decays back
 *                   into a claim through reuse or a later re-scan (AGENTS.md,
 *                   Confirmation UX invariant). Needs decided_on.
 * Variants and Japanese text take the same `status` values except retired.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadYaml } from '../../lib/yaml-document.mjs';

export const PROVENANCE = new Set(['V', 'M', 'U', 'T', 'E', 'C', '?']);
export const FACT_STATUS = new Set(['active', 'retired', 'rejected', 'cannot-confirm']);
export const BULLET_SECTIONS = new Set(['work', 'projects', 'volunteering']);
export const ENTITY_KEYS = ['experiences', 'projects', 'education'];
export const LIST_KEYS = ['summary', 'certifications', 'skills'];
const DEFAULT_SECTION = { experiences: 'work', projects: 'projects', education: 'education' };

export const profilePath = (root) => join(root, 'data', 'career-profile.yml');

/** Load the profile and index it. `text` lets a caller parse a draft instead of the file. */
export function loadProfile(root, text = null) {
  const path = profilePath(root);
  if (text == null && !existsSync(path)) throw new Error(`No master profile at ${path}`);
  const p = loadYaml(text ?? readFileSync(path, 'utf-8'));
  p._path = path;
  p._entities = [];
  p._facts = new Map();
  for (const key of ENTITY_KEYS) {
    for (const e of p[key] || []) {
      e.section ??= DEFAULT_SECTION[key];
      e._key = key;
      p._entities.push(e);
      for (const f of e.facts || []) p._facts.set(f.id, { fact: f, entity: e, kind: 'bullet' });
    }
  }
  for (const key of LIST_KEYS) {
    for (const f of p[key] || []) p._facts.set(f.id, { fact: f, entity: null, kind: key });
  }
  return p;
}

export const statusOf = (x) => x?.status ?? 'active';
export const isActive = (x) => statusOf(x) === 'active';
export const isVerified = (x) => (x?.review_status ?? 'verified') === 'verified';
/** A fact (or variant, or ja text) that may appear in a resume. */
export const isLive = (x) => isActive(x) && isVerified(x);
export const entityLive = (e) => isActive(e) && isVerified(e);
/** A draft still waiting on the candidate: active and not yet verified. */
export const isPending = (x) => isActive(x) && !isVerified(x);

/** Every wording a fact has been written in: canonical, variants, Japanese. */
export function forms(f) {
  const out = [{ form: 'text', text: f.text, verified: isVerified(f), live: isLive(f) }];
  for (const v of f.variants || []) out.push({ form: `variant:${v.key}`, text: v.text, verified: isVerified(v), live: isLive(f) && isLive(v) });
  if (f.ja?.text) out.push({ form: 'ja', text: f.ja.text, verified: isVerified(f.ja), live: isLive(f) && isLive(f.ja) });
  return out;
}

/** The wording a resume uses for a fact, or null when that wording can't be sent. */
export function factText(f, lang = 'en', variant = null) {
  if (lang === 'ja') return f.ja?.text && isLive(f.ja) ? f.ja.text : null;
  if (variant) {
    const v = (f.variants || []).find((x) => x.key === variant);
    if (v && isLive(v)) return v.text;
  }
  return f.text;
}

// ---------------------------------------------------------------- numbers

/** Digit runs as written, commas dropped, sorted. What a reader sees. */
export function numbers(text) {
  return (String(text).normalize('NFKC').match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [])
    .map((n) => n.replace(/,/g, '')).sort();
}

const SCALE = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, 千: 1e3, 万: 1e4, 億: 1e8 };

/**
 * Quantities with their scale applied, so one figure written two ways compares
 * equal: "~¥2M" and "約200万円" are both 2000000, "1,000" is 1000, "1.00" is 1.
 * A unit letter counts only as a whole token ("2M", "5k"), never the start of a
 * word ("45 minutes").
 */
export function quantities(text) {
  const t = String(text).normalize('NFKC');
  const out = [];
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:([kKmMbB])(?![a-zA-Z])|([千万億]))?/gu;
  for (const m of t.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ''));
    const scale = SCALE[m[2] || m[3]] || 1;
    out.push(String(Math.round(n * scale * 1e6) / 1e6));
  }
  return out.sort();
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, hundred: 100 };
const WORD_RE = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi');

/** quantities(), plus figures spelled as English words ("two migrations" counts as 2). */
export function claimQuantities(text) {
  const words = [...String(text).matchAll(WORD_RE)].map((m) => String(WORDS[m[1].toLowerCase()]));
  return [...quantities(text), ...words].sort();
}

export const sameNumbers = (a, b) => JSON.stringify(claimQuantities(a)) === JSON.stringify(claimQuantities(b));

/**
 * Japanese text against its English fact. A rate reads 「1日30件」 where English
 * says "30 a day": that 1 is grammar, not a claim, so one 1 per 1日/1週/1か月/1年/
 * 1回 is forgiven when the English has no matching 1. Returns the diff.
 */
export function jaNumberDiff(en, ja) {
  const enQ = claimQuantities(en);
  const jaQ = claimQuantities(ja);
  let grammatical = (String(ja).normalize('NFKC').match(/(?<![\d.])1(?=日|週|か月|ヶ月|カ月|年|回|時間)/gu) || []).length;
  const ones = (q) => q.filter((x) => x === '1').length;
  while (grammatical-- > 0 && ones(jaQ) > ones(enQ)) jaQ.splice(jaQ.indexOf('1'), 1);
  const minus = (x, y) => { const left = [...y]; return x.filter((v) => { const i = left.indexOf(v); if (i === -1) return true; left.splice(i, 1); return false; }); };
  return { added: minus(jaQ, enQ), removed: minus(enQ, jaQ) };
}
export const sameJaNumbers = (en, ja) => { const d = jaNumberDiff(en, ja); return !d.added.length && !d.removed.length; };

/** The quantities `b` has that `a` lacks, and the reverse, for a readable diff. */
export function numberDiff(before, after) {
  const a = claimQuantities(before);
  const b = claimQuantities(after);
  const minus = (x, y) => {
    const left = [...y];
    return x.filter((v) => { const i = left.indexOf(v); if (i === -1) return true; left.splice(i, 1); return false; });
  };
  return { removed: minus(a, b), added: minus(b, a) };
}

// ---------------------------------------------------------------- similarity

const STOP = new Set(('a an and the of to for in on at by with from as that this which so or its it is are was were be been '
  + 'into than then their his her he they them each every any all before after across per via vs who when where how').split(' '));
export const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w);
// Words every JD and every bullet share. They say nothing about fit.
export const JD_GENERIC = new Set(['team', 'work', 'while', 'week', 'develop', 'creat', 'engineer', 'check', 'pay', 'event',
  'design', 'build', 'built', 'help', 'make', 'new', 'able', 'also', 'more', 'other', 'our', 'your', 'you', 'will', 'can',
  'using', 'use', 'role', 'experience', 'strong', 'skill', 'ability', 'including', 'within', 'company', 'status', 'statu',
  'support', 'across', 'process', 'data', 'intern', 'internship'].map(stem));

export function tokens(text) {
  const t = String(text).normalize('NFKC').toLowerCase().replace(/\*\*/g, '');
  if (/[぀-ヿ一-鿿]/u.test(t)) {
    const s = t.replace(/[\s\p{P}\p{S}]/gu, '');
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  return new Set((t.match(/[a-z][a-z0-9+#-]*/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
}

export function similarity(line, factText) {
  const a = tokens(line);
  const b = tokens(factText);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of b) if (a.has(w)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  const contained = b.size >= 3 ? 0.9 * (inter / b.size) : 0;
  return Math.max(jaccard, contained);
}

export const slug = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
export const today = () => new Date().toISOString().slice(0, 10);
