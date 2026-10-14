/**
 * Platforms: every outside service shukatsu knows by name, in one list.
 *
 * Connectors are transports (a mailbox, a calendar feed, the browser
 * extension) and know how to fetch, not what arrived. This file is what
 * arrived means: which sender belongs to which job board or applicant
 * tracking system, which host is a posting, and which pages of a
 * login-walled board the extension may read. Adding a platform is adding an
 * entry here, with no new connector.
 *
 *   id, name   stable key and display name
 *   kind       'board'      where postings are found and applied through
 *                           (NUworks, Handshake, LinkedIn)
 *              'ats'        an employer's applicant tracking system; its mail
 *                           carries the real status of an application
 *              'assessment' a test vendor that only ever writes about one step
 *   hosts      web hosts, matched as the host itself or any subdomain of it
 *   mail       sender domains or full addresses the Gmail search asks for
 *   postings   hosts whose links in a message are postings worth filing
 *   passive    'dom' when the extension may read this board's pages as the
 *              candidate opens them; absent when it may not
 *   pages      for a passive board, the page kinds it reads, each matched
 *              against the path and query. A page on a passive host that
 *              matches none is logged by its path alone, so a wrong pattern
 *              shows up without its text ever being kept.
 *   automation 'never' where no software may act in the candidate's session
 *              (LinkedIn restricts accounts for it)
 *
 * Page patterns for a board are a first reading of its URLs and are corrected
 * from the paths the extension logs.
 */

export const PAGE_KINDS = ['posting', 'applications', 'application', 'messages', 'thread'];

export const PLATFORMS = [
  {
    id: 'nuworks', name: 'NUworks', kind: 'board',
    hosts: ['northeastern-csm.symplicity.com'], mail: ['symplicity.com'],
    passive: 'dom',
    pages: [
      ['posting', /^\/students\/app\/jobs\/detail\/|[?&]s=jobs\b.*[?&]mode=form/],
      ['applications', /^\/students\/app\/(applications|jobs\/applications)|[?&]ss=applications\b/],
      ['messages', /^\/students\/app\/messages\/?$/],
      ['thread', /^\/students\/app\/messages\/./],
    ],
  },
  {
    id: 'handshake', name: 'Handshake', kind: 'board',
    hosts: ['joinhandshake.com'], mail: ['joinhandshake.com'],
    passive: 'dom',
    pages: [
      ['posting', /^\/(stu\/)?(jobs|job-search)\/\d+|[?&]jobId=\d+/],
      ['applications', /^\/(stu\/)?applications\/?$/],
      ['application', /^\/(stu\/)?applications\/\d+/],
      ['messages', /^\/(stu\/)?messages\/?$/],
      ['thread', /^\/(stu\/)?messages\/\d+/],
    ],
  },
  {
    id: 'linkedin', name: 'LinkedIn', kind: 'board',
    hosts: ['linkedin.com'],
    // Only the senders that write about an application or a message, never the feed's notifications.
    mail: ['jobs-noreply@linkedin.com', 'messages-noreply@linkedin.com', 'inmail-hit-reply@linkedin.com', 'hit-reply@linkedin.com'],
    passive: 'dom',
    automation: 'never',
    pages: [
      ['posting', /^\/jobs\/view\/\d+|^\/jobs\/(search|collections)\/.*[?&]currentJobId=\d+/],
      ['applications', /^\/my-items\/saved-jobs\/?\?.*cardType=APPLIED/],
      ['thread', /^\/messaging\/thread\//],
    ],
  },
  {
    id: 'careerforum', name: 'CareerForum.Net', kind: 'board',
    hosts: ['careerforum.net'], mail: ['careerforum.net'],
    passive: 'dom',
    pages: [
      ['posting', /^\/(en|ja)\/.*(job|position)/i],
      ['applications', /^\/(en|ja)\/.*(mypage|application)/i],
    ],
  },
  { id: 'mynavi', name: 'マイナビ', kind: 'board', hosts: ['mynavi.jp'], mail: ['mynavi.jp'] },
  { id: 'rikunabi', name: 'リクナビ', kind: 'board', hosts: ['rikunabi.com'], mail: ['rikunabi.com'] },
  { id: 'onecareer', name: 'ONE CAREER', kind: 'board', hosts: ['onecareer.jp'], mail: ['onecareer.jp'] },
  { id: 'offerbox', name: 'OfferBox', kind: 'board', hosts: ['offerbox.jp'], mail: ['offerbox.jp'] },

  { id: 'greenhouse', name: 'Greenhouse', kind: 'ats', hosts: ['greenhouse.io'], mail: ['greenhouse.io'], postings: ['greenhouse.io'] },
  { id: 'lever', name: 'Lever', kind: 'ats', hosts: ['lever.co'], mail: ['lever.co'], postings: ['lever.co'] },
  { id: 'ashby', name: 'Ashby', kind: 'ats', hosts: ['ashbyhq.com'], mail: ['ashbyhq.com'], postings: ['ashbyhq.com'] },
  { id: 'workday', name: 'Workday', kind: 'ats', hosts: ['myworkdayjobs.com', 'myworkday.com'], mail: ['myworkday.com'], postings: ['myworkdayjobs.com'] },
  { id: 'icims', name: 'iCIMS', kind: 'ats', hosts: ['icims.com'], mail: ['icims.com'], postings: ['icims.com'] },
  { id: 'smartrecruiters', name: 'SmartRecruiters', kind: 'ats', hosts: ['smartrecruiters.com'], mail: ['smartrecruiters.com'], postings: ['smartrecruiters.com'] },
  { id: 'workable', name: 'Workable', kind: 'ats', hosts: ['workable.com'], mail: ['workable.com'], postings: ['workable.com'] },
  { id: 'taleo', name: 'Taleo', kind: 'ats', hosts: ['taleo.net'], mail: ['taleo.net'] },
  { id: 'successfactors', name: 'SuccessFactors', kind: 'ats', hosts: ['successfactors.com'], mail: ['successfactors.com'] },
  { id: 'jazzhr', name: 'JazzHR', kind: 'ats', hosts: ['applytojob.com'], mail: ['applytojob.com'] },
  { id: 'jobvite', name: 'Jobvite', kind: 'ats', hosts: ['jobvite.com'], mail: ['jobvite.com'] },
  { id: 'bamboohr', name: 'BambooHR', kind: 'ats', hosts: ['bamboohr.com'], mail: ['bamboohr.com'] },
  { id: 'avature', name: 'Avature', kind: 'ats', hosts: ['avature.net'] },

  { id: 'hirevue', name: 'HireVue', kind: 'assessment', hosts: ['hirevue.com'], mail: ['hirevue.com'] },
  { id: 'codesignal', name: 'CodeSignal', kind: 'assessment', hosts: ['codesignal.com'], mail: ['codesignal.com'] },
  { id: 'hackerrank', name: 'HackerRank', kind: 'assessment', hosts: ['hackerrank.com'], mail: ['hackerrank.com'] },
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
export const platform = (id) => BY_ID.get(id) || null;

const under = (host, base) => host === base || host.endsWith(`.${base}`);
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };

/** The platform a host belongs to, or null. */
export function platformOfHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return h ? PLATFORMS.find((p) => p.hosts.some((b) => under(h, b))) || null : null;
}

export const platformOfUrl = (url) => platformOfHost(hostOf(url));

/** The platform a sender address or domain belongs to, by its mail entries. */
export function platformOfSender(from) {
  const addr = String(from || '').toLowerCase().match(/[\w.+-]+@([\w.-]+)/);
  const domain = addr ? addr[1] : String(from || '').toLowerCase();
  const full = addr ? addr[0] : '';
  return PLATFORMS.find((p) => (p.mail || []).some((m) => (m.includes('@') ? m === full : under(domain, m)))) || null;
}

/**
 * What a page on a passive board is: { platform, kind } with kind one of
 * PAGE_KINDS or 'other'. Null when the URL isn't on a board the extension
 * may read.
 */
export function pageOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const p = platformOfHost(u.hostname);
  if (!p?.passive) return null;
  const at = `${u.pathname}${u.search}`;
  const hit = p.pages.find(([, re]) => re.test(at));
  return { platform: p, kind: hit ? hit[0] : 'other' };
}

/** Every sender the Gmail search asks for. */
export const mailSenders = () => [...new Set(PLATFORMS.flatMap((p) => p.mail || []))];

/** Whether a domain is a platform's rather than an employer's (so it never counts as a company domain). */
export const isPlatformDomain = (domain) => Boolean(platformOfHost(domain) || platformOfSender(domain));

/** Whether a message came from a job board, by its sender. */
export const fromBoard = (from) => platformOfSender(from)?.kind === 'board';

/** Whether a link points at a posting on an applicant tracking system. */
export const isPostingLink = (url) => {
  const h = hostOf(url);
  return Boolean(h) && PLATFORMS.some((p) => (p.postings || []).some((b) => under(h, b)));
};

/** The hosts the extension reads passively. extension/manifest.json must list exactly these. */
export const passiveHosts = () => PLATFORMS.filter((p) => p.passive).flatMap((p) => p.hosts);
