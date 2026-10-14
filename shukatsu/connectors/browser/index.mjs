/**
 * The browser extension's side of the daemon. The extension reads pages of a
 * login-walled board (platforms/: NUworks, Handshake, LinkedIn,
 * CareerForum.Net) as the candidate opens them and posts each one to
 * page.observe. Nothing here fetches anything: the connector is push-only, so
 * the scheduler never runs it, and its one account exists so the owner can
 * turn it on, pause it, and delete what it kept from the connections page.
 *
 * The extension first sends a page's URL alone. A page the board lists comes
 * back asking for its text (wants_text), and only then is the text read and
 * sent, so the text of any other page never leaves the browser.
 *
 * What is kept depends on the page:
 *
 *   a page kind the platform lists (a posting, the applications list, a
 *   message thread)   its URL, title, visible text, and links, one record per
 *                     page, replaced when the page is seen again
 *   any other page on that board   its path alone, with numbers and ids folded
 *                     (/jobs/view/:id) and a count, so a page pattern that
 *                     misses shows up without its text ever being kept
 *
 * The board decides what a page is, here, from the URL; the extension's own
 * claim isn't trusted. Page text is outside text: data, never instructions.
 */

import { normalizeUrl } from '../../../url-key.mjs';
import { getRecordByExternalId, listAccounts, markAttempt, markProcessed, signalOfRecord, upsertRecords } from '../../core/sync.mjs';
import { tidy } from '../../core/capture.mjs';
import { pageOf } from '../../platforms/index.mjs';
import { processRecords } from '../signals.mjs';

const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

export function prepare() {
  return { settings: {}, secret: null, status: 'ok' };
}

/** /jobs/view/4012345/ -> /jobs/view/:id. A segment with a digit in it is an id, not a page. */
export const shapeOf = (pathname) => String(pathname || '/').split('/').map((seg) => (/\d/.test(seg) ? ':id' : seg)).join('/').replace(/\/+$/, '') || '/';

const MAX_LINKS = 300;

/** The links worth keeping: http(s), unique, capped. */
const keepLinks = (links) => [...new Set((links || []).filter((l) => { try { return /^https?:$/.test(new URL(l).protocol); } catch { return false; } }))].slice(0, MAX_LINKS);

/** The browser account, or why there isn't one to write to. */
function accountFor(root) {
  const a = listAccounts(root, { connector: 'browser' })[0];
  if (!a) throw fail('Turn on the browser extension under Settings, Connections first.', 'not_connected', 409);
  if (a.status === 'paused') throw fail('The browser extension is paused under Settings, Connections.', 'paused', 409);
  return a;
}

/**
 * Keep one page the extension read. Returns what it was taken for and the
 * signal it made, if any.
 */
export function observe(root, { url, title = '', text = '', links = [], observed_at = null }) {
  const page = pageOf(url);
  if (!page) throw fail('That page isn\'t on a board the extension reads.', 'invalid_input');
  const account = accountFor(root);
  const at = observed_at && !Number.isNaN(Date.parse(observed_at)) ? new Date(observed_at).toISOString() : new Date().toISOString();
  const u = new URL(url);

  if (page.kind === 'other') {
    const shape = shapeOf(u.pathname);
    const external_id = `other:${u.hostname}${shape}`;
    const seen = (getRecordByExternalId(root, account.id, external_id)?.fields?.seen || 0) + 1;
    const [r] = upsertRecords(root, account.id, [{ kind: 'page', external_id, fields: { platform: page.platform.id, board: page.platform.name, page: 'other', host: u.hostname, shape, seen, observed_at: at }, text: null }]);
    markProcessed(root, r.id);
    markAttempt(root, account.id, { ok: true });
    return { platform: page.platform.id, page: 'other', kept: 'path', record: r.id, signal: null };
  }

  if (!String(text || '').trim()) return { platform: page.platform.id, page: page.kind, kept: 'none', record: null, signal: null, wants_text: true };
  const body = tidy(text);
  if (body.length < 40) throw fail('The page had no text yet. It is read again once it finishes loading.', 'invalid_input');
  const key = normalizeUrl(url) || url;
  const [r] = upsertRecords(root, account.id, [{
    kind: 'page',
    external_id: `${page.kind}:${key}`,
    fields: { platform: page.platform.id, board: page.platform.name, page: page.kind, url, title: String(title).slice(0, 300), links: keepLinks(links), observed_at: at },
    text: body,
  }]);
  processRecords(root);
  markAttempt(root, account.id, { ok: true });
  return { platform: page.platform.id, page: page.kind, kept: 'page', record: r.id, signal: signalOfRecord(root, r.id)?.id ?? null };
}
