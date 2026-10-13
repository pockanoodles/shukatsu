/**
 * Wall-clock times in a named timezone, with nothing but Intl.
 *
 * A deadline posted as "Oct 26, 8:00 JST" is stored as the instant it is
 * (UTC) and the zone it was written in (Asia/Tokyo), so it can be shown the
 * way the employer wrote it and the way the candidate lives it, and the
 * calendar feed can carry the zone instead of a guessed offset.
 */

const parts = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]),
);

/** The zone's offset from UTC at `date`, in minutes (Tokyo is +540). */
export function offsetMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * "2026-10-26T08:00" in "Asia/Tokyo" -> the UTC instant as an ISO string.
 * A date with no time is midnight there. A time that a DST change skips is
 * moved forward, the way calendars treat it.
 */
export function zonedToUtc(local, timeZone) {
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`"${local}" isn't a date or a date and time (YYYY-MM-DDTHH:MM).`);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // Two passes settle the offset across a DST boundary.
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t).toISOString().replace(/\.000Z$/, 'Z');
}

/** An instant as wall-clock parts in a zone: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function utcToZoned(iso, timeZone) {
  const p = parts(new Date(iso), timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function validZone(timeZone) {
  try { new Intl.DateTimeFormat('en', { timeZone }); return true; } catch { return false; }
}

/** The zone this machine runs in, the default for a person's own events. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
