/**
 * The outgoing calendar: shukatsu's events as an iCalendar feed that Apple
 * Calendar, Google Calendar, and Outlook subscribe to without OAuth.
 *
 * Timed events go out in UTC, which every client places correctly in the
 * subscriber's own zone. The zone an event was written in still matters, so
 * a deadline posted in JST says so in its description ("08:00 JST, Oct 26").
 * A cancelled event stays in the feed as STATUS:CANCELLED, which is how a
 * subscribed calendar learns to drop it.
 *
 * `audience` decides what a feed shows: the owner sees notes and meeting
 * links; family sees when and where, which is what they need to keep a day free.
 */

import { localZone, utcToZoned } from './tz.mjs';

const escape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold to 75 octets per line (RFC 5545 3.1), never splitting a UTF-8 character. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf-8'));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return out.join('\r\n ');
}

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = (d) => d.replace(/-/g, '');
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const ZONE_LABEL = { 'Asia/Tokyo': 'JST', 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Los_Angeles': 'PT', 'Europe/London': 'UK time', UTC: 'UTC' };
const zoneLabel = (tz) => ZONE_LABEL[tz] || tz;

const KIND_PREFIX = { deadline: 'Due', interview: 'Interview', followup: 'Follow up', fair: 'Fair', task: 'To do', other: '' };

/** "08:00 JST, Oct 26" for a timed event, in the zone it was written in. */
export function writtenAs(e) {
  if (e.all_day) return null;
  const { date, time } = utcToZoned(e.starts_at, e.timezone);
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${time} ${zoneLabel(e.timezone)}, ${day}`;
}

function vevent(e, { host, audience }) {
  const owner = audience === 'owner';
  const prefix = KIND_PREFIX[e.kind] || '';
  const title = prefix && !e.title.toLowerCase().startsWith(prefix.toLowerCase()) ? `${prefix}: ${e.title}` : e.title;
  const desc = [
    // The time as the employer or fair wrote it, when that's not this machine's own zone.
    writtenAs(e) && (e.kind === 'deadline' || e.timezone !== localZone()) ? `${e.kind === 'deadline' ? 'Deadline as posted' : 'As written'}: ${writtenAs(e)}.` : null,
    e.round ? `Round: ${e.round}` : null,
    e.tracker_num ? `Application #${e.tracker_num}` : null,
    owner && e.meeting_url ? `Join: ${e.meeting_url}` : null,
    owner && e.note ? e.note : null,
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:shukatsu-event-${e.id}@${host}`,
    `DTSTAMP:${stamp(e.updated_at || e.created_at)}`,
    `SEQUENCE:${Math.floor(Date.parse(e.updated_at || e.created_at) / 1000) - Math.floor(Date.parse(e.created_at) / 1000)}`,
    ...(e.all_day
      ? [`DTSTART;VALUE=DATE:${dateValue(e.starts_at)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(e.ends_at || e.starts_at))}`]
      : [`DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(e.ends_at || (e.kind === 'deadline' ? e.starts_at : new Date(Date.parse(e.starts_at) + 3_600_000).toISOString()))}`]),
    `SUMMARY:${escape(title)}`,
    ...(desc ? [`DESCRIPTION:${escape(desc)}`] : []),
    ...(e.location ? [`LOCATION:${escape(e.location)}`] : []),
    ...(owner && e.meeting_url ? [`URL:${escape(e.meeting_url)}`] : []),
    `CATEGORIES:${escape(e.kind)}`,
    `TRANSP:${e.kind === 'deadline' || e.kind === 'followup' || e.kind === 'task' ? 'TRANSPARENT' : 'OPAQUE'}`,
    `STATUS:${e.cancelled_at ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  // A reminder the day before and two hours before a deadline (Apple honors feed alarms; Google ignores them).
  if (e.kind === 'deadline' && !e.cancelled_at && !e.done_at) {
    for (const trigger of ['-P1D', '-PT2H']) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(title)}`, `TRIGGER:${trigger}`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

/** The whole feed as text. `events` are rows from core/events.mjs. */
export function renderCalendar(events, { name = 'shukatsu', host = 'shukatsu.local', audience = 'owner' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//shukatsu//calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    ...events.flatMap((e) => vevent(e, { host, audience })),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
