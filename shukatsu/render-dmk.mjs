#!/usr/bin/env node

/**
 * D'Amore-McKim resume renderer: a finalized CV (`*-cv.final.md`, as written by
 * `master.mjs finalize`) to the one-page HTML that generate-pdf.mjs prints.
 *
 * Why this exists instead of build-cv-html.mjs: upstream's payload has no dates
 * on projects and no volunteering section, so an agent had to hand-write that
 * JSON and improvise around the gaps (dates folded into project names, literal
 * "--" separators). This reads the verified final draft directly, so the PDF
 * says exactly what finalize checked, with no hand step in between.
 *
 * Layout follows Northeastern's undergraduate resume format: Education first,
 * centered bold name, plain contact line, bold caps headings over a full-width
 * rule, role over company with dates on the right, black links with no
 * underline, Times-class serif, no colour.
 *
 * Usage:
 *   node shukatsu/render-dmk.mjs <final.md> <out.html> [--format letter|a4]
 *   node generate-pdf.mjs <out.html> <out.pdf> --format=letter
 */

import { readFileSync, writeFileSync } from 'fs';
import { isMainModule } from '../lib/is-main-module.mjs';

// Section order on the page; anything not listed follows in draft order.
const ORDER = ['education', 'skills', 'certifications', 'work experience', 'experience', 'projects', 'leadership', 'volunteering'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const plain = (s) => String(s).replace(/\*\*/g, '');
const dash = (s) => String(s).replace(/\s+--\s+/g, ' – ');
const isUrl = (s) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}\/\S*$/i.test(s.trim());
const href = (s) => (/^https?:\/\//.test(s) ? s : `https://${s}`);

export function parse(md) {
  const header = {};
  const sections = [];
  let sec = null;
  let entry = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith('<!--')) continue;
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) { sec = { title: line.slice(3).trim(), entries: [], items: [] }; sections.push(sec); entry = null; continue; }
    if (!sec) {
      const m = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (m) header[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    if (line.startsWith('### ')) { entry = { heading: line.slice(4).trim(), lines: [], bullets: [] }; sec.entries.push(entry); continue; }
    if (line.startsWith('- ')) { (entry ? entry.bullets : sec.items).push(line.slice(2).trim()); continue; }
    (entry ? entry.lines : sec.items).push(line.trim());
  }
  return { header, sections };
}

const row = (left, right = '') => `<div class="row"><span>${left}</span><span class="date">${right}</span></div>`;
const bullets = (bs) => (bs.length ? `<ul>${bs.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>` : '');

function education(e) {
  const [org, loc] = e.heading.split(/\s+--\s+/);
  const [degree, ...rest] = e.lines;
  const date = rest.find((l) => /\d{4}/.test(l)) || '';
  return `<div class="entry">${row(`<strong><em>${esc(org)}</em></strong>${loc ? `, ${esc(loc)}` : ''}`, `<em>${esc(date)}</em>`)}`
    + (degree ? `<div>${esc(plain(degree))}</div>` : '')
    + e.bullets.map((b) => `<div>${esc(plain(b))}</div>`).join('') + '</div>';
}

// Work and volunteering: "**Role** (context)" over "Org – Location ... dates".
function job(e) {
  const [org, loc] = e.heading.split(/\s+--\s+/);
  const roleLine = e.lines.find((l) => l.startsWith('**')) || '';
  const m = roleLine.match(/^\*\*(.+?)\*\*\s*(?:\((.+)\))?/);
  const dates = e.lines.find((l) => l !== roleLine) || '';
  return `<div class="entry">${m ? `<div><strong>${esc(m[1])}</strong></div>` : ''}`
    + row(`${esc(org)}${loc ? ` – ${esc(loc)}` : ''}`, esc(dates))
    + (m && m[2] ? `<div class="context">${esc(m[2][0].toUpperCase() + m[2].slice(1))}</div>` : '')
    + bullets(e.bullets) + '</div>';
}

function project(e) {
  const [name, role] = e.heading.split(/\s+--\s+/);
  const parts = (e.lines[0] || '').split(' · ').map((s) => s.trim()).filter(Boolean);
  const url = parts.find(isUrl);
  const dates = parts.filter((p) => p !== url).join(' · ');
  const title = url ? `<a href="${esc(href(url))}">${esc(name)}</a>` : esc(name);
  return `<div class="entry">${row(`<strong>${title}</strong>${role ? ` – <em>${esc(role)}</em>` : ''}`, `<em>${esc(dates)}</em>`)}`
    + bullets(e.bullets) + '</div>';
}

function items(sec, key) {
  if (key === 'skills') {
    return sec.items.map((s) => {
      const m = s.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      return `<div>${m ? `${esc(m[1])} – ${esc(m[2])}` : inline(s)}</div>`;
    }).join('');
  }
  return sec.items.map((s) => `<div>${inline(s)}</div>`).join('');
}

export function renderDmk(md, { format = 'letter' } = {}) {
  const { header: h, sections } = parse(md);
  const key = (s) => s.title.toLowerCase();
  const rank = (s) => { const i = ORDER.indexOf(key(s)); return i < 0 ? ORDER.length : i; };
  const ordered = sections.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
  const name = (md.match(/^# (?:CV -- )?(.+)$/m) || [, ''])[1];

  const contact = [
    h.phone && `<a href="tel:${esc(h.phone.replace(/[^\d+]/g, ''))}">${esc(h.phone)}</a>`,
    h.email && `<a href="mailto:${esc(h.email)}">${esc(h.email)}</a>`,
    h.linkedin && `<a href="${esc(href(h.linkedin))}">${esc(h.linkedin)}</a>`,
    h.github && `<a href="${esc(href(h.github))}">${esc(h.github)}</a>`,
    h.location && esc(h.location),
  ].filter(Boolean).join(' | ');

  const body = ordered.map((s) => {
    const k = key(s);
    const render = k === 'education' ? education : k === 'projects' ? project : job;
    return `<section><h2>${esc(s.title)}</h2>${s.entries.map(render).join('')}${items(s, k)}</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(name)} Resume</title>
<style>
  /* ATS: static system serif and no ligatures (see templates/cv-template.jake.html). */
  :root { --page-margin: 0.5in; }
  @page { margin: var(--page-margin); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${format === 'a4' ? '210mm' : '8.5in'}; font-family: "Times New Roman", "Liberation Serif", Times, serif;
    font-size: 10.5pt; line-height: 1.22; color: #000; background: #fff;
    font-variant-ligatures: none; font-feature-settings: "liga" 0, "clig" 0; }
  a { color: inherit; text-decoration: none; }
  header { text-align: center; margin-bottom: 6pt; }
  h1 { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.02em; }
  .avail { font-style: italic; }
  section { margin-top: 7pt; }
  h2 { font-size: 10.5pt; font-weight: bold; text-transform: uppercase; border-bottom: 0.75pt solid #000; margin-bottom: 3pt; }
  .entry { margin-bottom: 5pt; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12pt; }
  .date { white-space: nowrap; text-align: right; }
  .context { font-style: italic; }
  ul { margin: 1pt 0 0 16pt; }
  li { margin-bottom: 1pt; }
</style></head>
<body>
<header><h1>${esc(name)}</h1><div>${contact}</div>${h.availability ? `<div class="avail">${esc(dash(h.availability))}</div>` : ''}</header>
${body}
</body></html>
`;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--format');
  const format = fi >= 0 ? args.splice(fi, 2)[1] : 'letter';
  const [input, output] = args;
  if (!input || !output) {
    console.error('Usage: node shukatsu/render-dmk.mjs <final.md> <out.html> [--format letter|a4]');
    process.exit(2);
  }
  writeFileSync(output, renderDmk(readFileSync(input, 'utf-8'), { format }));
  console.log(`Wrote ${output}`);
}
