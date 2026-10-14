/**
 * What the Gmail connector asks for. It searches, so only mail that matches
 * is ever fetched and stored, and the rest of the mailbox stays in Google.
 *
 * The search is built from three sources of senders and one list of subject
 * words:
 *
 *   - every platform's mail entries in platforms/: the applicant tracking
 *     systems, the assessment vendors, and the job boards (NUworks, Handshake,
 *     LinkedIn's application and message senders, careerforum.net, the
 *     Japanese boards)
 *   - the company domains of the tracker's rows, from their posting URLs and from
 *     reply-matcher's own getAppDomains (a domain in the notes, a contact)
 *   - the domains of active campaigns' pages
 *
 * Gmail limits how long a query can be, so a long list of domains becomes
 * several queries whose results are joined.
 */

import { getAppDomains } from '../../../reply-matcher.mjs';
import { listCampaigns } from '../../core/campaigns.mjs';
import { readTracker } from '../../core/tracker.mjs';
import { isPlatformDomain, mailSenders } from '../../platforms/index.mjs';

export const SUBJECT_TERMS = ['interview', 'assessment', 'application', 'offer', '面接', '選考', '内定', 'エントリー'];

const SECOND_LEVELS = new Set(['co', 'com', 'ne', 'or', 'ac', 'org', 'gov']);

/** acme.example.co.uk -> example.co.uk; careers.acme.com -> acme.com. */
export function registrable(host) {
  const parts = String(host).toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const take = parts[parts.length - 1].length === 2 && SECOND_LEVELS.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join('.');
}

const isVendor = (domain) => isPlatformDomain(domain) || ['google.com', 'gmail.com'].some((v) => domain === v || domain.endsWith(`.${v}`));

/** Company and campaign domains from the tracker and the active campaigns. */
export function companyDomains(root) {
  const out = new Set();
  const add = (d) => { if (d && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !isVendor(d)) out.add(d); };
  let rows = [];
  try { rows = readTracker(root).rows; } catch { /* no tracker yet */ }
  for (const row of rows) {
    if (row.url) { try { add(registrable(new URL(row.url).hostname)); } catch { /* not a URL */ } }
    for (const d of getAppDomains(row, [])) add(registrable(d));
  }
  try {
    for (const c of listCampaigns(root)) if (c.url) { try { add(registrable(new URL(c.url).hostname)); } catch { /* not a URL */ } }
  } catch { /* no app.db yet */ }
  return [...out].sort();
}

/**
 * The queries for one sync. `days` becomes newer_than:Nd, `domains` is every
 * sender domain to look for, and `maxLength` keeps each query under what
 * Gmail accepts. The subject words ride on the first query.
 */
export function buildQueries({ domains, subjectTerms = SUBJECT_TERMS, days = 7, maxLength = 1400 }) {
  const unique = [...new Set(domains.map((d) => d.toLowerCase()))].sort();
  const tail = ` newer_than:${Math.max(1, Math.floor(days))}d`;
  const subject = subjectTerms.length ? `subject:(${subjectTerms.join(' OR ')})` : '';
  const chunks = [];
  let cur = [];
  const size = (list) => `from:(${list.join(' OR ')})`.length;
  for (const d of unique) {
    if (cur.length && size([...cur, d]) + subject.length + tail.length + 12 > maxLength) { chunks.push(cur); cur = []; }
    cur.push(d);
  }
  if (cur.length || !chunks.length) chunks.push(cur);
  return chunks.map((list, i) => {
    const parts = [];
    if (list.length) parts.push(`from:(${list.join(' OR ')})`);
    if (i === 0 && subject) parts.push(subject);
    return `(${parts.join(' OR ')})${tail}`;
  });
}

/** Every sender (a domain, or a full address for a platform that sends mostly noise) worth searching for this account. */
export function searchDomains(root, extra = []) {
  return [...new Set([...mailSenders(), ...companyDomains(root), ...extra])];
}
