/**
 * ics-in: read any calendar feed (the Canvas calendar feed first) so what is
 * already on the candidate's schedule counts when an interview time is
 * checked.
 *
 * Each sync fetches the whole feed, since a feed is a snapshot, and stores
 * every VEVENT as one record in its raw form (see parse.mjs). Nothing is
 * expanded here: busyTimes() expands for whatever window a conflict check
 * asks about, so a recurring class is right for next March as well as
 * next week. The feed's address is a credential (Canvas puts a private token in
 * it), so it lives in the encrypted secret and only its host is kept in the
 * clear.
 *
 * Events never enter app.db. They are copies in sync.db, and they reach the
 * calendar only as busy time through the source boot() registers.
 */

import { listAccounts, listRecords } from '../../core/sync.mjs';
import { localZone, validZone } from '../../core/tz.mjs';
import { occurrences, parseIcs } from './parse.mjs';

/** webcal:// is https:// under another name. */
export function feedUrl(raw) {
  const text = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  let u;
  try { u = new URL(text); } catch { throw new Error('That is not a calendar feed address. Paste the whole link, starting with https:// or webcal://.'); }
  if (u.protocol !== 'https:') throw new Error('A calendar feed has to be an https:// or webcal:// address.');
  return u.href;
}

/** Turn what the settings form sent into an account's settings and secret. */
export function prepare(input, previous = null) {
  const url = input.url ? feedUrl(input.url) : previous?.secret?.url;
  if (!url) throw new Error('A calendar feed needs its address.');
  const timezone = input.timezone ?? previous?.settings?.timezone ?? localZone();
  if (!validZone(timezone)) throw new Error(`"${timezone}" isn't a timezone. Use a name like America/New_York.`);
  return { settings: { host: new URL(url).hostname, timezone }, secret: { url } };
}

export async function sync(account, _cursor, ctx) {
  const url = account.secret?.url;
  if (!url) throw new Error('This feed has no address.');
  const text = await ctx.fetchText(url, { purpose: 'feed', headers: { accept: 'text/calendar, text/plain, */*' } });
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That address did not return a calendar feed.');
  const { name, events, zones } = parseIcs(text);
  const records = events.map((ev) => ({
    kind: 'event',
    external_id: ev.recurrence_id ? `${ev.uid}#${ev.recurrence_id.v}` : ev.uid,
    fields: { ...ev, calendar: name, zones },
    text: [ev.summary, ev.location, ev.description].filter(Boolean).join('\n'),
  }));
  return { records, cursor: { events: records.length, at: new Date().toISOString() }, prune: 'event' };
}

/**
 * Busy time for a window, from every calendar feed that is connected.
 * Classes and exams come back as ordinary busy items. A due date (zero
 * length, or a whole day) comes back with kind "deadline", so a conflict
 * check can say "due that day" and not "you are busy".
 */
export function busyTimes(root, { from, until }) {
  const out = [];
  for (const account of listAccounts(root, { connector: 'ics-in' })) {
    if (account.status === 'paused') continue;
    const events = listRecords(root, { accountId: account.id, kind: 'event' }).map((r) => r.fields);
    if (!events.length) continue;
    const zones = events.find((e) => e.zones)?.zones || {};
    const defaultZone = account.settings.timezone || localZone();
    for (const o of occurrences(events, { from, until, zones, defaultZone })) {
      out.push({
        title: o.summary || '(busy)', starts_at: o.starts_at, ends_at: o.ends_at, all_day: o.all_day,
        source: `ics-in:${account.label}`, kind: o.deadline ? 'deadline' : 'busy',
        ...(o.location ? { location: o.location } : {}),
      });
    }
  }
  return out;
}
