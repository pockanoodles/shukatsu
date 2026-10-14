/*
 * Which option of a list an answer names. One matcher for both ends: the
 * server plans a <select> with it (apply/plan.mjs imports this file), and the
 * filler picks from a list only the page can see (a searchable dropdown, a
 * select too long to send) with the same code, so the two never disagree.
 *
 * A wrong pick is worse than no pick: an empty box is the candidate's to
 * answer, a wrong one goes to the employer. So every step below returns
 * nothing, or a tie, rather than its best guess.
 *
 *   1. the same words, after aliases: "USA" is "United States of America",
 *      "MA" is "Massachusetts", "Boston, MA" is "Boston, Massachusetts"
 *   2. yes or no: never an option that says the opposite. "No" never picks
 *      "I do not require sponsorship"'s twin "I require sponsorship", and a
 *      bare "Yes" picks the one option that says yes, whether it starts with
 *      "Yes" or is a statement ("I am authorized to work in the US")
 *   3. whole words at the start: "Boston, MA" picks "Boston, Massachusetts,
 *      United States" and not "Boston, England"; "Data" picks "Data analysis"
 *      and not "Database administration"; "No" never picks "North Carolina"
 *   4. a degree by its level ("B.S. Business Administration" picks
 *      "Bachelor's Degree"), a date by its year or month when the list is
 *      years or months
 *   5. the one option sharing most words, by a clear margin
 * "Other", "Prefer not to say", and the like are never a fuzzy pick.
 *
 * Plain script, no imports: the extension injects it into the page, and
 * Node loads it for its side effect.
 */

(() => {
  if (globalThis.__shukatsuMatch) return;

  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/n['’]t\b/gi, ' not')
    .toLowerCase().replace(/[*✱]+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = (s) => (s ? s.split(' ') : []);

  // ------------------------------------------------------------------ aliases

  const COUNTRIES = {
    'united states': ['us', 'u s', 'usa', 'u s a', 'united states of america', 'america', 'the united states'],
    'united kingdom': ['uk', 'u k', 'great britain', 'britain', 'the united kingdom', 'united kingdom of great britain and northern ireland'],
    'japan': ['jp', '日本', 'nihon', 'nippon'],
    'canada': ['ca'],
    'south korea': ['korea', 'republic of korea', 'korea republic of', 'korea south', 'kr'],
    'china': ['prc', 'people s republic of china', 'mainland china', 'cn'],
    'taiwan': ['tw', 'taiwan province of china'],
    'hong kong': ['hk', 'hong kong sar', 'hong kong sar china'],
    'germany': ['de', 'deutschland'],
    'netherlands': ['nl', 'the netherlands', 'holland'],
    'india': ['in'],
    'singapore': ['sg'],
    'australia': ['au'],
    'france': ['fr'],
    'ireland': ['ie', 'republic of ireland'],
    'mexico': ['mx'],
    'switzerland': ['ch'],
    'spain': ['es'],
    'brazil': ['br'],
    'israel': ['il'],
    'sweden': ['se'],
    'italy': ['it'],
    'vietnam': ['viet nam', 'vn'],
    'philippines': ['ph', 'the philippines'],
  };
  const STATES = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware',
    dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
    ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota',
    ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey',
    nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon',
    pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
    vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
  };
  // Spelled-out names alias in any case; a code ("MA", "US", "U.S.") only in capitals, so "in", "or", and "us" stay words.
  // A lone code that is both a state and a country (CA, DE, IN, IL) is the state: these are US forms far more often.
  const isCode = (a) => a.replace(/ /g, '').length <= 3 && /^[a-z ]+$/.test(a);
  const NAMES = new Map();
  const CODES = new Map();
  for (const [name, alts] of Object.entries(COUNTRIES)) {
    NAMES.set(name, name);
    for (const a of alts) (isCode(a) ? CODES : NAMES).set(a, name);
  }
  for (const [code, name] of Object.entries(STATES)) { NAMES.set(name, name); CODES.set(code, name); }

  /** One comma-separated part, as its alias's name when it is one. */
  function canonPart(raw) {
    const f = fold(raw);
    if (NAMES.has(f)) return NAMES.get(f);
    const bare = String(raw).trim();
    if (/^[A-Z](\.?\s?[A-Z]){1,2}\.?$/.test(bare) && CODES.has(f)) return CODES.get(f);
    return f;
  }

  /** The words an option or answer is compared by: each comma-separated part folded and aliased ("Boston, MA" -> "boston massachusetts"). */
  const key = (s) => String(s || '').split(/\s*[,/|]\s*|\s+[–—-]{1,2}\s+|\s+\(|\)\s*/).filter((p) => p.trim()).map(canonPart).filter(Boolean).join(' ');

  /** The countries a question names, as alias names ("in the U.S." -> united states). Codes other than US and UK are too often words. */
  function countriesIn(text) {
    const raw = String(text || '');
    const f = ` ${fold(raw)} `;
    const out = new Set();
    for (const [name, alts] of Object.entries(COUNTRIES)) {
      if ([name, ...alts].some((a) => !isCode(a) && a !== 'america' && f.includes(` ${fold(a)} `))) out.add(name);
    }
    if (/(^|[^A-Za-z])U\.?\s?S\.?(\s?A\.?)?(?![A-Za-z])/.test(raw)) out.add('united states');
    if (/(^|[^A-Za-z])U\.?K\.?(?![A-Za-z])/.test(raw)) out.add('united kingdom');
    return out;
  }

  // ------------------------------------------------------------------ polarity

  const DECLINE = /\b(prefer not|decline|do not wish|rather not|choose not|not to (say|answer|disclose|identify|self identify)|i don ?t know|not sure|unsure)\b/;
  const NEGATION = /\b(no|not|never|none|neither|nor|without|cannot)\b/;
  const OTHER = /^(other|others|something else|none of the above|not listed)\b/;

  /** 'yes', 'no', or 'decline' for an answer or option that takes a side, else null. */
  function side(s) {
    const f = fold(s);
    if (!f) return null;
    if (DECLINE.test(f)) return 'decline';
    if (/^(yes|y|true|i do|i am|i will|i have)$/.test(f) || /^yes\b/.test(f)) return 'yes';
    if (/^(no|n|false)$/.test(f) || /^no\b/.test(f)) return 'no';
    return NEGATION.test(f) ? 'no' : 'yes';
  }
  const bare = (s) => /^(yes|no|y|n|true|false)$/.test(fold(s));

  // ------------------------------------------------------------------ levels and dates

  function level(s) {
    const t = String(s || '');
    const f = fold(t);
    if (/\b(ph d|phd|doctor(ate|al)?|d phil|dphil)\b/.test(f)) return 'doctorate';
    if (/\b(masters?|mba|msc|meng)\b/.test(f) || /\bM\.?\s?(S|A|Eng|Sc)\.?(\s|$|,)/.test(t)) return 'master';
    if (/\b(bachelors?|undergrad(uate)?|bsc|beng|bba)\b/.test(f) || /\bB\.?\s?(S|A|Eng|Sc)\.?(\s|$|,)/.test(t)) return 'bachelor';
    if (/\bassociates?\b/.test(f) || /\bA\.?\s?A\.?S?\.?(\s|$|,)/.test(t)) return 'associate';
    if (/\b(high school|secondary school|ged)\b/.test(f)) return 'high school';
    return null;
  }

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthOf = (s) => { const f = fold(s); const i = MONTHS.findIndex((m) => new RegExp(`\\b(${m}|${m.slice(0, 3)}|${m.slice(0, 4)})\\b`).test(f)); return i < 0 ? null : i; };
  const yearsIn = (s) => String(s || '').match(/\b(19|20)\d{2}\b/g) || [];

  // ------------------------------------------------------------------ the pick

  const PLACEHOLDER = /^(select|choose|please select|please choose|pick|none selected)?\s*(an? )?(option|one|value|answer|item)?$/;
  const PSEUDO = /^(loading|searching|no (options|results|matches)( found)?|type to search|start typing)\b/;

  /** Whether an option is something a person could choose ("Select...", "Loading…", "No results" are not). */
  const real = (o) => { const f = fold(o?.text); return Boolean(f) && !PLACEHOLDER.test(f) && !PSEUDO.test(f); };

  /** Whether `a`'s words start `b`'s. */
  const startsWords = (a, b) => { const x = words(a); const y = words(b); return x.length > 0 && x.length <= y.length && x.every((w, i) => w === y[i]); };

  function overlap(a, b) {
    const x = new Set(words(a).filter((w) => w.length > 1));
    const y = new Set(words(b).filter((w) => w.length > 1));
    if (!x.size || !y.size) return 0;
    let n = 0;
    for (const w of x) if (y.has(w)) n++;
    return n / (x.size + y.size - n);
  }

  const leads = (want) => /^(yes|no)\b/.test(fold(want));
  const pick = (list, fuzzy) => (list.length === 1 ? { index: list[0].i, fuzzy } : list.length > 1 ? { index: -1, tied: list.map((o) => o.i) } : null);

  /** A yes or no answered from options that are statements: only when the options take both sides and exactly one takes this one. */
  function statement(all, ws) {
    const statements = all.filter((o) => !o.other && o.side !== 'decline');
    if (statements.length < 2 || !statements.some((o) => o.side !== ws)) return null;
    return pick(statements.filter((o) => o.side === ws), true);
  }

  /**
   * The option `want` names, among `options` ([{ text, value }] or strings).
   * Returns { index, fuzzy } for a pick, { index: -1, tied: [indexes] } when
   * more than one fits equally, or null when none does.
   */
  function choose(options, want) {
    const w = key(want);
    if (!w || !Array.isArray(options)) return null;
    const all = options.map((o, i) => {
      const text = typeof o === 'string' ? o : o?.text;
      const value = typeof o === 'string' ? '' : o?.value;
      return { i, text, k: key(text), v: fold(value), side: side(text), other: OTHER.test(fold(text)) };
    }).filter((o) => real({ text: o.text }));

    // 1. the same words
    const exact = all.filter((o) => o.k === w || fold(o.text) === fold(want));
    if (exact.length) return { index: exact[0].i, fuzzy: false };
    const byValue = all.filter((o) => o.v && o.v === fold(want) && !/^\d+$/.test(o.v));
    if (byValue.length === 1) return { index: byValue[0].i, fuzzy: false };

    // 2. a side taken is never matched to the opposite side
    const ws = side(want);
    const sided = bare(want) || ws === 'decline' || all.filter((o) => !o.other && o.side !== 'decline').some((o) => o.side !== ws);
    // "Other" and "Prefer not to say" only when the answer says so.
    const pool = all.filter((o) => (sided ? o.side === ws : true) && (o.side !== 'decline' || ws === 'decline') && (!o.other || OTHER.test(fold(want))));
    if (bare(want)) {
      const said = pool.filter((o) => new RegExp(`^${ws}\\b`).test(fold(o.text)));
      if (said.length) return pick(said, true);
      return statement(all, ws);
    }

    // 3. whole words at the start, the more specific option first
    const longer = pool.filter((o) => startsWords(w, o.k));
    if (longer.length) return pick(longer, true);
    const shorter = pool.filter((o) => startsWords(o.k, w)).sort((a, b) => words(b.k).length - words(a.k).length);
    if (shorter.length) return shorter.length === 1 || words(shorter[0].k).length > words(shorter[1].k).length ? { index: shorter[0].i, fuzzy: true } : pick(shorter.filter((o) => words(o.k).length === words(shorter[0].k).length), true);

    // 4. a degree's level; a date's year or month when the list is years or months
    const lv = level(want);
    if (lv && all.filter((o) => level(o.text)).length >= 2) {
      const same = pool.filter((o) => level(o.text) === lv);
      if (same.length > 1) {
        const best = same.map((o) => ({ ...o, s: overlap(o.k, w) })).sort((a, b) => b.s - a.s);
        if (best[0].s - best[1].s >= 0.15) return { index: best[0].i, fuzzy: true };
      }
      return pick(same, true);
    }
    const years = yearsIn(want);
    if (years.length === 1 && all.filter((o) => /^\d{4}$/.test(fold(o.text))).length >= all.length * 0.6) return pick(all.filter((o) => fold(o.text) === years[0]), true);
    const m = monthOf(want);
    if (m != null && all.filter((o) => monthOf(o.text) != null && words(fold(o.text)).length <= 2).length >= 10) return pick(all.filter((o) => monthOf(o.text) === m && !yearsIn(o.text).length), true);

    // 5. every word of the answer in one option, then the clear best overlap
    const holds = pool.filter((o) => words(w).filter((x) => x.length > 1).every((x) => words(o.k).includes(x)));
    if (holds.length) return pick(holds, true);
    const scored = pool.map((o) => ({ ...o, s: overlap(o.k, w) })).filter((o) => o.s >= 0.5).sort((a, b) => b.s - a.s);
    if (!scored.length) return leads(want) ? statement(all, ws) : null;
    if (scored.length === 1 || scored[0].s - scored[1].s >= 0.15) return { index: scored[0].i, fuzzy: true };
    return { index: -1, tied: scored.filter((o) => scored[0].s - o.s < 0.15).map((o) => o.i) };
  }

  globalThis.__shukatsuMatch = { choose, countriesIn, key, real, side, level, fold };
})();
