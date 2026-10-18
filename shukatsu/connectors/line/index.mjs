/**
 * LINE: the weekly digest, delivered where the family already reads.
 *
 * The install has its own LINE Official Account with the Messaging API on.
 * The owner pastes its channel secret and channel access token on the
 * connections page, and people link their own LINE account from Settings
 * (core/notify.mjs). After that:
 *
 *   sync          once a day, asks LINE who the account is (/v2/bot/info). It
 *                 copies nothing: it proves the token still works and learns
 *                 the account's @id for the add-friend link.
 *   deliverDue    once a minute (from syncDue); at the owner's chosen weekday
 *                 and hour in the chosen zone, pushes the digest to everyone
 *                 linked who still has access, once per week.
 *   sendDigest    the same push now (notify.send).
 *   webhook       /connectors/line/webhook. LINE posts follows, unfollows, and
 *                 messages here, signed with the channel secret. A six-digit
 *                 code links the sender; any other text gets a fixed reply.
 *                 Message text is never kept or logged.
 *
 * What a push carries is the owner's choice, per install:
 *
 *   nudge (default)  the week's dates, three counts, and a link to the app.
 *                    No company, role, or name reaches LINE.
 *   full             the digest text itself (companies, roles, status moves,
 *                    who helped), as digest.week renders it.
 *
 * Messages from an Official Account aren't end-to-end encrypted, so whatever
 * is pushed is stored by LINE's operator (LY Corporation). See DATAFLOW.md.
 *
 * Every request goes through ctx.mjs's fetch, pinned to api.line.me and
 * written to egress.log without its body.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { digest, digestNudge, digestText } from '../../core/digest.mjs';
import { codeIn, forgetAddress, recipients, redeem } from '../../core/notify.mjs';
import { systemAgent } from '../../core/people.mjs';
import { logActivity } from '../../core/store.mjs';
import { getCursor, getSecret, listAccounts, markAttempt, setCursor } from '../../core/sync.mjs';
import { utcToZoned, validZone } from '../../core/tz.mjs';
import { makeConnectorCtx } from '../ctx.mjs';

const API = 'https://api.line.me';
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf-8'));
export const MODES = ['nudge', 'full'];
const TEXT_MAX = 5000; // LINE's limit for one text message

// ---------------------------------------------------------------- settings

export function prepare(input, previous = null) {
  const secret = String(input.channel_secret ?? previous?.secret?.channel_secret ?? '').trim();
  const token = String(input.channel_access_token ?? previous?.secret?.channel_access_token ?? '').trim();
  if (!secret || !token) throw new Error('LINE needs the channel secret and the channel access token from the LINE Developers console.');
  if (!/^[0-9a-f]{32}$/i.test(secret)) throw new Error('That isn\'t a channel secret: it is 32 letters and digits, under Basic settings in the LINE Developers console.');
  const was = previous?.settings || {};
  const settings = {
    mode: input.mode ?? was.mode ?? 'nudge',
    weekday: input.weekday ?? was.weekday ?? 0,
    hour: input.hour ?? was.hour ?? 9,
    timezone: input.timezone ?? was.timezone ?? 'Asia/Tokyo',
  };
  if (!MODES.includes(settings.mode)) throw new Error('The digest is sent as a nudge or in full.');
  if (!Number.isInteger(settings.weekday) || settings.weekday < 0 || settings.weekday > 6) throw new Error('The weekday is 0 (Sunday) to 6 (Saturday).');
  if (!Number.isInteger(settings.hour) || settings.hour < 0 || settings.hour > 23) throw new Error('The hour is 0 to 23.');
  if (!validZone(settings.timezone)) throw new Error(`"${settings.timezone}" isn't a time zone.`);
  return { settings, secret: { channel_secret: secret, channel_access_token: token }, status: previous ? undefined : 'ok' };
}

/** The one LINE account, live (not paused), with its secret. */
function active(root) {
  const a = listAccounts(root, { connector: 'line' }).find((x) => x.status !== 'paused');
  return a ? { ...a, secret: getSecret(root, a.id) } : null;
}

// ---------------------------------------------------------------- requests

/** One call to the Messaging API. The real fetch throws on an error status and a recorded one doesn't, so both end up here as { status, body }. */
async function call(ctx, account, path, { method = 'GET', body = null, purpose }) {
  const headers = { Authorization: `Bearer ${account.secret.channel_access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  let res;
  try {
    res = await ctx.fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : null, purpose });
  } catch (e) {
    if (e?.status) return { status: e.status, body: null, error: e.message };
    throw e;
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: json, error: res.ok ? null : `HTTP ${res.status}${json?.message ? `: ${json.message}` : ''}` };
}

const refused = (status) => (status === 401
  ? 'LINE refused the channel access token. Issue a new one under Messaging API in the LINE Developers console and paste it here.'
  : null);

const clip = (text) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text);
const push = (ctx, account, to, text, purpose = 'line.push') => call(ctx, account, '/v2/bot/message/push', { method: 'POST', body: { to, messages: [{ type: 'text', text: clip(text) }] }, purpose });
const reply = (ctx, account, replyToken, text) => call(ctx, account, '/v2/bot/message/reply', { method: 'POST', body: { replyToken, messages: [{ type: 'text', text: clip(text) }] }, purpose: 'line.reply' });

/** The daily check: is the token good, and what is the account's @id. Copies nothing. */
export async function sync(account, cursor, ctx) {
  const r = await call(ctx, account, '/v2/bot/info', { purpose: 'line.info' });
  if (r.error) throw new Error(refused(r.status) || `LINE didn't answer the account check: ${r.error}`);
  return { records: [], cursor: { basic_id: r.body?.basicId || null, name: r.body?.displayName || null } };
}

/** The add-friend link for the account, once a check has learned its @id. */
export function addFriendUrl(root) {
  const a = listAccounts(root, { connector: 'line' })[0];
  const id = a ? getCursor(root, a.id)?.basic_id : null;
  return id ? `https://line.me/R/ti/p/${encodeURIComponent(id)}` : null;
}

// ---------------------------------------------------------------- the digest

/** The app's address for a link in a chat message, or null when it is only reachable on this machine. */
function appUrl() {
  try {
    const u = new URL(process.env.SHUKATSU_URL || '');
    return u.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(u.hostname) ? `${u.origin}/digest` : null;
  } catch {
    return null;
  }
}

/**
 * Push this week's digest now: to one person (`userId`) or everyone linked
 * who still has access. Each gets it in their own language. Returns
 * { mode, sent, failed, error }, never an address.
 */
export async function sendDigest(root, { userId = null, fetch = null, nowMs = Date.now() } = {}) {
  const account = active(root);
  if (!account) throw Object.assign(new Error('Connect LINE under Settings, Connections first, or resume it.'), { code: 'not_connected', status: 409 });
  const to = recipients(root, 'line', { userId });
  const mode = account.settings.mode || 'nudge';
  if (!to.length) return { mode, sent: 0, failed: 0, error: null };
  const d = digest(root, { days: 7, until: new Date(nowMs) });
  const url = appUrl();
  const ctx = makeConnectorCtx(root, manifest, account, { fetch });
  let sent = 0;
  let error = null;
  for (const p of to) {
    const text = mode === 'full' ? digestText(d, p.lang) : digestNudge(d, p.lang, url);
    const r = await push(ctx, account, p.address, text, 'line.digest');
    if (r.error) error = refused(r.status) || r.error;
    else sent++;
  }
  if (error) markAttempt(root, account.id, { ok: false, error });
  return { mode, sent, failed: to.length - sent, error };
}

/**
 * Called every minute. Sends once per week, at or after the chosen hour on
 * the chosen weekday in the chosen zone; a daemon that was down for the whole
 * day skips that week rather than sending a stale digest late.
 */
export async function deliverDue(root, { fetch = null, nowMs = Date.now() } = {}) {
  const account = active(root);
  if (!account) return null;
  const { weekday = 0, hour = 9, timezone = 'Asia/Tokyo' } = account.settings;
  const { date, time } = utcToZoned(new Date(nowMs).toISOString(), timezone);
  if (new Date(`${date}T12:00:00Z`).getUTCDay() !== weekday || Number(time.slice(0, 2)) < hour) return null;
  if (getCursor(root, account.id, 'digest')?.date === date) return null;
  // Recorded before sending, so a failure is reported once instead of retried every minute. "Send now" is there for a retry.
  setCursor(root, account.id, { date }, 'digest');
  const out = await sendDigest(root, { fetch, nowMs });
  setCursor(root, account.id, { date, sent: out.sent, failed: out.failed }, 'digest');
  if (out.sent || out.failed) logActivity(root, { actor: systemAgent(root), verb: 'notify.sent', subject: 'channel:line', detail: { mode: out.mode, sent: out.sent, failed: out.failed, scheduled: true } });
  return out;
}

// ---------------------------------------------------------------- webhook

const SAY = {
  welcome: 'shukatsu です。アプリの「設定」の LINE 欄に出る6桁のコードを、ここに送ってください。\n\nThis is shukatsu. Send the 6-digit code shown under LINE in the app\'s Settings.',
  linked: {
    ja: (name) => `${name}さん、連携しました。毎週の就活レポートがここに届きます。`,
    en: (name) => `Linked, ${name}. The weekly digest will arrive here.`,
  },
  badCode: 'コードが違うか、期限が切れています（15分）。アプリで新しいコードを出してください。\n\nThat code is wrong or has expired (codes last 15 minutes). Get a new one in the app.',
  slowDown: '試行が多すぎます。1時間ほどしてからお試しください。\n\nToo many tries. Please wait an hour and try again.',
  notifyOnly: 'このアカウントはお知らせ専用です。返信やコメントはアプリでお願いします。\n\nThis account only sends updates. Please reply or comment in the app.',
};

export function signatureOk(channelSecret, raw, signature) {
  if (!channelSecret || !signature) return false;
  const want = createHmac('sha256', channelSecret).update(raw).digest();
  let got;
  try { got = Buffer.from(String(signature), 'base64'); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * One webhook delivery. Returns { status } for the HTTP answer: 404 with no
 * LINE account, 401 for a bad signature, 200 otherwise (LINE retries
 * anything else, so a reply that fails is not the webhook failing).
 * `limited(key, max, windowMs)` is the daemon's rate limiter.
 */
export async function webhook(root, { raw, signature, limited, fetch = null }) {
  const account = active(root);
  if (!account) return { status: 404 };
  if (!signatureOk(account.secret.channel_secret, raw, signature)) return { status: 401 };
  let events = [];
  try { events = JSON.parse(raw.toString('utf-8')).events || []; } catch { return { status: 400 }; }
  const ctx = makeConnectorCtx(root, manifest, account, { fetch });
  const answer = async (event, text) => {
    if (!event.replyToken) return;
    try { await reply(ctx, account, event.replyToken, text); } catch { /* egress.log has it */ }
  };
  for (const event of events.slice(0, 50)) {
    const address = event.source?.type === 'user' ? event.source.userId : null;
    if (!address) continue; // groups and rooms are not people
    if (event.type === 'unfollow') { forgetAddress(root, { channel: 'line', address }); continue; }
    if (event.deliveryContext?.isRedelivery) continue; // a code was already tried once; its reply token is spent
    if (event.type === 'follow') { await answer(event, SAY.welcome); continue; }
    if (event.type !== 'message') continue;
    const code = event.message?.type === 'text' ? codeIn(event.message.text) : null;
    if (!code) { await answer(event, SAY.notifyOnly); continue; }
    if (limited(`line:code:${address}`, 5, 3_600_000) || limited('line:code', 30, 3_600_000)) { await answer(event, SAY.slowDown); continue; }
    const person = redeem(root, { channel: 'line', code, address });
    await answer(event, person ? (SAY.linked[person.lang] || SAY.linked.en)(person.name) : SAY.badCode);
  }
  return { status: 200 };
}
