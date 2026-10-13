/**
 * An iCalendar (RFC 5545) reader, written for what a student's feeds
 * contain: Canvas, Google Calendar, and Outlook exports.
 *
 * It does two jobs. `parseIcs` turns the text into plain event objects that
 * are stored as they came (so a feed is fetched once and read at any window
 * later), and `occurrences` expands them across a window, which is where the
 * rules about time live:
 *
 *   - a recurring class is expanded in wall-clock time in its own TZID and then
 *     converted, so a 10:00 class stays at 10:00 across a daylight saving change
 *   - an all-day event stays a date, never an instant
 *   - EXDATE, RECURRENCE-ID overrides, and STATUS:CANCELLED remove occurrences
 *   - RRULE covers DAILY, WEEKLY, MONTHLY, and YEARLY with INTERVAL, COUNT,
 *     UNTIL, BYDAY (with a number in a month), BYMONTHDAY, BYMONTH, and WKST
 *
 * It is not a full calendar engine (no BYSETPOS, BYWEEKNO, BYYEARDAY, or
 * RDATE), and an event using them is read as if the part were absent.
 *
 * Canvas lists assignment due dates as zero-length or all-day events. Those
 * are flagged `deadline`: they take no time, but they are worth listing.
 */

import { utcToZoned, validZone, zonedToUtc } from '../../core/tz.mjs';

const DAY = 86_400_000;
const MAX_OCCURRENCES = 5000;

// Windows names Outlook writes, mapped to the IANA names the rest of the system uses.
const WINDOWS_ZONES = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'US Mountain Standard Time': 'America/Phoenix', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'China Standard Time': 'Asia/Shanghai', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'India Standard Time': 'Asia/Kolkata', 'UTC': 'UTC',
};

// ---------------------------------------------------------------- lines

/** Unfold continuation lines (a line starting with a space or tab continues the one before). */
export function unfold(text) {
  const out = [];
  for (const raw of String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out.filter((l) => l.length);
}

/** `DTSTART;TZID=America/New_York:20261005T100000` -> { name, params, value }. Quoted parameter values may hold ':' and ';'. */
export function parseLine(line) {
  let i = 0;
  let quoted = false;
  let split = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) { split = i; break; }
  }
  if (split < 0) return null;
  const head = line.slice(0, split);
  const value = line.slice(split + 1);
  const parts = [];
  let cur = '';
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** TEXT values escape backslash, semicolon, comma, and newline. */
export const unescapeText = (v) => String(v).replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// ---------------------------------------------------------------- times

/**
 * A DATE or DATE-TIME property as { v, z, tz, d }: `v` is "YYYY-MM-DD" or
 * "YYYY-MM-DDTHH:MM:SS" as written, `z` is true for a UTC "Z" time, `tz` is
 * the TZID, `d` is true for a date.
 */
export function parseTime(value, params = {}) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined || params.VALUE === 'DATE') return { v: date, z: false, tz: null, d: true };
  return { v: `${date}T${m[4]}:${m[5]}:${m[6] || '00'}`, z: Boolean(m[7]), tz: params.TZID || null, d: false };
}

/** An ISO-8601 duration ("PT1H30M", "P1W", "-PT15M") in milliseconds. */
export function parseDuration(v) {
  const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = (+(m[2] || 0) * 7 + +(m[3] || 0)) * DAY + (+(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** The IANA zone for a TZID, trying the feed's own VTIMEZONE hints, Windows names, and path-style ids. */
function resolveZone(tzid, hints, fallback) {
  if (!tzid) return fallback;
  const candidates = [tzid, hints[tzid], WINDOWS_ZONES[tzid]];
  const parts = String(tzid).split('/');
  if (parts.length > 1) candidates.push(parts.slice(-2).join('/'), parts[parts.length - 1]);
  // A bare abbreviation (EST, PDT) has no daylight saving rules, so it is no better than not knowing.
  return candidates.find((c) => c && validZone(c) && !/^(EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/.test(c)) || fallback;
}

/** A parsed time as a UTC millisecond instant. Dates are not instants; callers keep them as dates. */
function instantOf(t, zoneFor) {
  if (t.z) return Date.parse(`${t.v}Z`);
  return Date.parse(zonedToUtc(t.v, zoneFor(t.tz)));
}

const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY);
const dateOfDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const localParts = (v) => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
  return { y: +m[1], mo: +m[2], d: +m[3], time: m[4] === undefined ? null : `${m[4]}:${m[5]}:${m[6]}` };
};

// ---------------------------------------------------------------- parse

const RRULE_LISTS = new Set(['BYDAY', 'BYMONTHDAY', 'BYMONTH']);

export function parseRRule(value) {
  const rule = {};
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).toUpperCase();
    const v = part.slice(eq + 1);
    rule[k] = RRULE_LISTS.has(k) ? v.split(',').filter(Boolean) : v;
  }
  if (rule.INTERVAL) rule.INTERVAL = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  if (rule.COUNT) rule.COUNT = parseInt(rule.COUNT, 10) || null;
  if (rule.UNTIL) rule.UNTIL = parseTime(rule.UNTIL);
  return rule.FREQ ? rule : null;
}

/**
 * Read a feed. Returns { name, events }, where each event keeps its times as
 * written (see parseTime) so it can be expanded for any window later.
 */
export function parseIcs(text) {
  const events = [];
  const zoneHints = {};
  let name = null;
  let ev = null;
  let zone = null;
  let alarm = 0;
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT') ev = { uid: null, recurrence_id: null, summary: '', description: '', location: '', url: '', status: '', start: null, end: null, duration: null, rrule: null, exdates: [] };
      else if (p.value === 'VTIMEZONE') zone = { tzid: null, loc: null };
      else if (p.value === 'VALARM' && ev) alarm++;
      continue;
    }
    if (p.name === 'END') {
      if (p.value === 'VEVENT' && ev) { if (ev.uid && ev.start) events.push(finish(ev)); ev = null; }
      else if (p.value === 'VTIMEZONE' && zone) { if (zone.tzid && zone.loc) zoneHints[zone.tzid] = zone.loc; zone = null; }
      else if (p.value === 'VALARM' && alarm) alarm--;
      continue;
    }
    if (zone && !ev) {
      if (p.name === 'TZID') zone.tzid = p.value;
      if (p.name === 'X-LIC-LOCATION') zone.loc = p.value;
      continue;
    }
    if (!ev) { if (p.name === 'X-WR-CALNAME') name = unescapeText(p.value); continue; }
    if (alarm) continue;
    switch (p.name) {
      case 'UID': ev.uid = p.value.trim(); break;
      case 'SUMMARY': ev.summary = unescapeText(p.value); break;
      case 'DESCRIPTION': ev.description = unescapeText(p.value); break;
      case 'LOCATION': ev.location = unescapeText(p.value); break;
      case 'URL': ev.url = p.value.trim(); break;
      case 'STATUS': ev.status = p.value.trim().toUpperCase(); break;
      case 'DTSTART': ev.start = parseTime(p.value, p.params); break;
      case 'DTEND': ev.end = parseTime(p.value, p.params); break;
      case 'DURATION': ev.duration = parseDuration(p.value); break;
      case 'RRULE': ev.rrule = parseRRule(p.value); break;
      case 'RECURRENCE-ID': ev.recurrence_id = parseTime(p.value, p.params); break;
      case 'EXDATE':
        for (const v of p.value.split(',')) { const t = parseTime(v, p.params); if (t) ev.exdates.push(t); }
        break;
      default: break;
    }
  }
  return { name, events, zones: zoneHints };
}

/** What a due date looks like in a feed: no length at all, one whole day, or an assignment's own id. */
function isDeadline(ev) {
  if (/assignment/i.test(ev.uid)) return true;
  if (ev.rrule) return false;
  if (ev.start.d) {
    const end = ev.end?.d ? dayNumber(ev.end.v) - dayNumber(ev.start.v) : ev.duration != null ? Math.round(ev.duration / DAY) : 1;
    return end <= 1;
  }
  if (ev.end && ev.end.v === ev.start.v && ev.end.z === ev.start.z) return true;
  return !ev.end && !ev.duration;
}

function finish(ev) {
  return { ...ev, deadline: isDeadline(ev), cancelled: ev.status === 'CANCELLED' };
}

// ---------------------------------------------------------------- expand

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const weekdayOf = (n) => (((n + 4) % 7) + 7) % 7; // day 0 (1970-01-01) was a Thursday
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** "MO", "1MO", "-1FR" -> { n, wd }. */
function byDay(token) {
  const m = String(token).match(/^([+-]?\d+)?([A-Z]{2})$/);
  return m && WEEKDAYS.includes(m[2]) ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAYS.indexOf(m[2]) } : null;
}

/**
 * The local dates (as day numbers) a rule produces, in order, starting at
 * DTSTART. A generator, so a caller stops when it has what it needs.
 */
function* ruleDays(rule, startDay, windowEndDay) {
  const interval = rule.INTERVAL || 1;
  const wkst = Math.max(0, WEEKDAYS.indexOf(rule.WKST || 'MO'));
  const months = (rule.BYMONTH || []).map(Number);
  const days = (rule.BYDAY || []).map(byDay).filter(Boolean);
  const monthDays = (rule.BYMONTHDAY || []).map(Number);
  const startParts = localParts(dateOfDay(startDay));
  const inMonth = (n) => !months.length || months.includes(localParts(dateOfDay(n)).mo);
  const stop = (n) => n > windowEndDay + 1;

  if (rule.FREQ === 'DAILY') {
    for (let n = startDay; !stop(n); n += interval) {
      const wd = weekdayOf(n);
      if (inMonth(n) && (!days.length || days.some((d) => d.wd === wd)) && (!monthDays.length || monthDays.includes(localParts(dateOfDay(n)).d))) yield n;
    }
  } else if (rule.FREQ === 'WEEKLY') {
    const wanted = days.length ? days.map((d) => d.wd) : [weekdayOf(startDay)];
    const weekStart = startDay - ((weekdayOf(startDay) - wkst + 7) % 7);
    for (let w = weekStart; !stop(w); w += 7 * interval) {
      const week = wanted.map((wd) => w + ((wd - wkst + 7) % 7)).sort((a, b) => a - b);
      for (const n of week) if (n >= startDay && inMonth(n)) yield n;
    }
  } else if (rule.FREQ === 'MONTHLY' || rule.FREQ === 'YEARLY') {
    const yearly = rule.FREQ === 'YEARLY';
    // A yearly rule with no BYMONTH repeats on DTSTART's month, so it only needs to look at one month a year.
    const step = yearly && !months.length ? 12 : 1;
    let y = startParts.y;
    let mo = startParts.mo;
    for (;;) {
      const first = Date.UTC(y, mo - 1, 1) / DAY;
      if (first > windowEndDay + 1) return;
      const offset = (y * 12 + mo) - (startParts.y * 12 + startParts.mo);
      const periodOk = yearly ? Math.floor(offset / 12) % interval === 0 : offset % interval === 0;
      if (periodOk && inMonth(first)) {
        const dim = daysInMonth(y, mo);
        const picked = new Set();
        if (days.length) {
          for (const { n, wd } of days) {
            const all = [];
            for (let d = 1; d <= dim; d++) if (weekdayOf(first + d - 1) === wd) all.push(first + d - 1);
            if (!n) all.forEach((x) => picked.add(x));
            else { const x = n > 0 ? all[n - 1] : all[all.length + n]; if (x !== undefined) picked.add(x); }
          }
        } else if (monthDays.length) {
          for (const d of monthDays) { const dd = d > 0 ? d : dim + d + 1; if (dd >= 1 && dd <= dim) picked.add(first + dd - 1); }
        } else if (startParts.d <= dim) picked.add(first + startParts.d - 1);
        for (const n of [...picked].sort((a, b) => a - b)) if (n >= startDay) yield n;
      }
      mo += step;
      while (mo > 12) { mo -= 12; y++; }
    }
  }
}

/**
 * Every start of one event inside [from, until] (milliseconds), as
 * { startDay, time } local pairs with their instants. `zoneFor` maps a TZID to an IANA zone.
 */
function expandOne(ev, { from, until, zoneFor }) {
  const out = [];
  const allDay = ev.start.d;
  const startLocal = localParts(ev.start.v);
  const startDay = dayNumber(ev.start.v.slice(0, 10));
  const zone = zoneFor(ev.start.z ? 'UTC' : ev.start.tz);
  const startInstant = allDay ? null : instantOf(ev.start, zoneFor);
  let spanMs = 0;
  let spanDays = 1;
  if (allDay) {
    spanDays = ev.end?.d ? Math.max(1, dayNumber(ev.end.v) - startDay) : ev.duration != null ? Math.max(1, Math.round(ev.duration / DAY)) : 1;
  } else if (ev.end && !ev.end.d) spanMs = instantOf(ev.end, zoneFor) - startInstant;
  else if (ev.duration != null) spanMs = ev.duration;
  spanMs = Math.max(0, spanMs);

  const toOcc = (day, time) => {
    if (allDay) return { all_day: true, start: dateOfDay(day), end: dateOfDay(day + spanDays - 1), startMs: day * DAY, endMs: (day + spanDays) * DAY };
    // A UTC event keeps its UTC wall clock; a zoned one keeps its zone's wall clock across daylight saving.
    const local = `${dateOfDay(day)}T${time}`;
    const s = ev.start.z ? Date.parse(`${local}Z`) : Date.parse(zonedToUtc(local, zone));
    return { all_day: false, start: new Date(s).toISOString(), end: new Date(s + spanMs).toISOString(), startMs: s, endMs: s + spanMs };
  };

  if (!ev.rrule) {
    const occ = toOcc(startDay, startLocal.time);
    if (occ.endMs >= from && occ.startMs <= until) out.push(occ);
    return out;
  }

  const rule = ev.rrule;
  const untilMs = rule.UNTIL ? (rule.UNTIL.d ? (dayNumber(rule.UNTIL.v) + 1) * DAY - 1 : instantOf(rule.UNTIL, zoneFor)) : Infinity;
  const windowEndDay = Math.floor(Math.min(until, untilMs, 9e15) / DAY);
  let count = 0;
  for (const day of ruleDays(rule, startDay, windowEndDay)) {
    const occ = toOcc(day, startLocal.time);
    if (occ.startMs > untilMs) break;
    count++;
    if (rule.COUNT && count > rule.COUNT) break;
    if (count > MAX_OCCURRENCES * 4) break;
    if (occ.endMs >= from && occ.startMs <= until) out.push(occ);
    else if (occ.startMs > until) break;
    if (out.length > MAX_OCCURRENCES) break;
  }
  return out;
}

/** Whether an EXDATE or RECURRENCE-ID names this occurrence. */
function sameMoment(t, occ, ev, zoneFor) {
  if (t.d) return occ.start.slice(0, 10) === t.v || (!occ.all_day && utcToZoned(occ.start, zoneFor(ev.start.z ? 'UTC' : ev.start.tz)).date === t.v);
  if (occ.all_day) return false;
  return instantOf(t, zoneFor) === occ.startMs;
}

/**
 * The occurrences of a feed's events that touch [from, until] (ISO strings or
 * milliseconds). Each is { uid, summary, location, description, url,
 * all_day, starts_at, ends_at, deadline }: a timed one has UTC instants, an
 * all-day one has dates with `ends_at` the last day included.
 *
 * `zones` are the feed's TZID hints from parseIcs, and `defaultZone` reads a
 * time with no zone at all (a "floating" time), which is where the person is.
 */
export function occurrences(events, { from, until, zones = {}, defaultZone = 'America/New_York' }) {
  const lo = typeof from === 'number' ? from : Date.parse(from);
  const hi = typeof until === 'number' ? until : Date.parse(until);
  const zoneFor = (tzid) => resolveZone(tzid, zones, defaultZone);
  const overrides = new Map();
  for (const ev of events) if (ev.recurrence_id) {
    if (!overrides.has(ev.uid)) overrides.set(ev.uid, []);
    overrides.get(ev.uid).push(ev);
  }
  const out = [];
  const push = (ev, occ) => out.push({
    uid: ev.uid, summary: ev.summary, location: ev.location, description: ev.description, url: ev.url,
    all_day: occ.all_day, starts_at: occ.start, ends_at: occ.all_day || occ.end !== occ.start ? occ.end : null, deadline: Boolean(ev.deadline),
  });
  for (const ev of events) {
    if (ev.recurrence_id) {
      if (!ev.cancelled) for (const occ of expandOne({ ...ev, rrule: null }, { from: lo, until: hi, zoneFor })) push(ev, occ);
      continue;
    }
    if (ev.cancelled) continue;
    const mine = overrides.get(ev.uid) || [];
    for (const occ of expandOne(ev, { from: lo, until: hi, zoneFor })) {
      if (ev.exdates.some((x) => sameMoment(x, occ, ev, zoneFor))) continue;
      if (mine.some((o) => sameMoment(o.recurrence_id, occ, ev, zoneFor))) continue;
      push(ev, occ);
    }
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
