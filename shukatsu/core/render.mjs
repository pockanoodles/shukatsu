/**
 * Render a CV in cv.md's format from the master profile.
 *
 * `pick` is null for the full render (every live fact, profile order), or a Map
 * entityId -> [{id, variant, text?}] in bullet order. A pick entry's `text`
 * replaces the fact's wording (a JD rewording); `finalize` checks it against the
 * fact it names.
 *
 * With `tags: true` every bullet carries its fact ID as an HTML comment
 * (`- text <!-- fact:foresight.dial-volume -->`). That is the draft format: the
 * comment is the bullet's declared provenance, so a reworded line is checked
 * against the fact it says it states rather than found by guesswork. Markdown
 * renderers and bullet-lint ignore it; `finalize` strips it from the deliverable.
 */

import { entityLive, factText, isLive } from './facts.mjs';

export const JA_HEADINGS = {
  summary: '概要', work: '職務経歴', projects: 'プロジェクト', education: '学歴',
  certifications: '資格', volunteering: '課外活動', skills: 'スキル',
};

export const FACT_TAG = /\s*<!--\s*fact:([a-z0-9.-]+)(?:\/([a-z0-9-]+))?\s*-->\s*$/;
export const tagFor = (id, variant) => ` <!-- fact:${id}${variant ? `/${variant}` : ''} -->`;
export const stripTags = (text) => text.split('\n').map((l) => l.replace(FACT_TAG, '')).join('\n');

const LABELS = {
  en: [['Location', 'location'], ['Email', 'email'], ['Phone', 'phone'], ['LinkedIn', 'linkedin'], ['GitHub', 'github'], ['Availability', 'availability']],
  ja: [['所在地', 'location'], ['メール', 'email'], ['電話', 'phone'], ['LinkedIn', 'linkedin'], ['GitHub', 'github'], ['就業可能期間', 'availability']],
};

/**
 * The contact block. In Japanese, `candidate.ja` overrides any field (name,
 * location, availability): Japanese employers want 2027年1月〜6月, not "co-op".
 */
function headerLines(p, lang) {
  const c = p.candidate || {};
  const ja = lang === 'ja' ? c.ja || {} : {};
  const value = (k) => ja[k] ?? c[k];
  const title = lang === 'ja' ? `# 職務経歴書 -- ${value('name')}` : `# CV -- ${c.name}`;
  return [title, '', ...LABELS[lang === 'ja' ? 'ja' : 'en'].filter(([, k]) => value(k)).map(([l, k]) => `**${l}:** ${value(k)}`)];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * "May 2026 – August 2026" -> "2026年5月〜2026年8月", "Present" -> "現在". Only the
 * date words move; anything after the range (" · github.com/...") is kept as is,
 * and a string it can't read comes back unchanged.
 */
export function jaDates(s) {
  if (!s) return s;
  const one = (part) => {
    const t = part.trim();
    if (/^(present|current|now)$/i.test(t)) return '現在';
    let m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
    if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return `${m[2]}年${MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1}月`;
    m = t.match(/^(\d{4})$/);
    if (m) return `${m[1]}年`;
    return null;
  };
  const [range, ...rest] = String(s).split(' · ');
  const ends = range.split(/\s*[–-]\s*/);
  const conv = ends.map(one);
  if (conv.some((x) => x == null)) return s;
  return [conv.join('〜'), ...rest].join(' · ');
}

export function render(p, { pick = null, lang = 'en', summaryId = null, tags = false } = {}) {
  const skipped = [];
  const out = [...headerLines(p, lang), ''];
  const section = (name, heading, lines) => {
    if (!lines.length) return;
    out.push(`## ${lang === 'ja' ? (JA_HEADINGS[name] || heading) : heading}`, '', ...lines, '');
  };
  const line = (f, variant, override) => {
    const t = override ?? factText(f, lang, variant);
    if (t == null) { skipped.push(f.id); return null; }
    // A Japanese line declares the fact's Japanese wording (`/ja`), so it's checked against that.
    return tags ? `${t}${tagFor(f.id, lang === 'ja' ? 'ja' : variant)}` : t;
  };

  for (const { section: name, heading } of p.layout) {
    if (name === 'summary') {
      const live = (p.summary || []).filter(isLive);
      const s = live.find((x) => x.id === summaryId) || live[0];
      const t = s && line(s);
      section(name, heading, t ? [t] : []);
    } else if (name === 'certifications') {
      // Certifications are proper nouns that Japanese CVs commonly list in
      // English, so a certification with no Japanese keeps its English wording.
      section(name, heading, (p.certifications || []).filter(isLive).map((f) => (lang === 'ja' ? factText(f, 'ja') ?? f.text : line(f))).filter(Boolean).map((t) => `- ${t}`));
    } else if (name === 'skills') {
      section(name, heading, (p.skills || []).filter(isLive).map((f) => `- **${f.group}:** ${f.text}`));
    } else {
      const lines = [];
      for (const e of p._entities.filter((x) => x.section === name && entityLive(x))) {
        let chosen;
        if (pick) {
          if (!pick.has(e.id)) continue;
          chosen = pick.get(e.id).filter(({ id }) => p._facts.has(id))
            .map(({ id, variant, text }) => [p._facts.get(id).fact, variant, text]);
        } else chosen = (e.facts || []).filter(isLive).map((f) => [f, null, undefined]);
        const ja = lang === 'ja' ? e.ja || {} : {};
        lines.push(`### ${ja.org || e.heading}`, '');
        const head = [];
        if (e.title) head.push(ja.title ? `**${ja.title}**` : `**${e.title}**${e.title_suffix || ''}`);
        const dates = ja.dates || (lang === 'ja' ? jaDates(e.dates) : e.dates);
        if (dates) head.push(dates);
        if (head.length) lines.push(...head, '');
        const bullets = chosen.map(([f, v, t]) => line(f, v, t)).filter(Boolean).map((t) => `- ${t}`);
        if (bullets.length) lines.push(...bullets, '');
      }
      while (lines.at(-1) === '') lines.pop();
      section(name, heading, lines);
    }
  }
  while (out.at(-1) === '') out.pop();
  return { text: `${out.join('\n')}\n`, skipped };
}

export const GENERATED = '<!-- Generated by shukatsu/master.mjs from data/career-profile.yml. Edit the profile, then run: node shukatsu/master.mjs render --write -->';
export const withBanner = (text) => `${text}\n${GENERATED}\n`;
