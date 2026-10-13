/**
 * The calendar: what's coming up, what conflicts, and the events themselves.
 * Outside calendars (Canvas, Google, Outlook) count as busy time through the
 * busy sources connectors register; they are never copied into events.
 */

import * as ev from '../events.mjs';
import { localZone } from '../tz.mjs';
import { S } from './schema.mjs';

/** Busy-time providers: (root, { from, until }) => [{ title, starts_at, ends_at, all_day, source }]. Connectors add theirs. */
export const busySources = [];
export const addBusySource = (fn) => { busySources.push(fn); };

async function outsideBusy(root, from, until) {
  const out = [];
  for (const fn of busySources) {
    try { out.push(...(await fn(root, { from, until }))); } catch { /* a broken feed shouldn't block scheduling */ }
  }
  return out;
}

export const EVENT_INPUT = S.obj({
  kind: S.enum(ev.EVENT_KINDS),
  title: S.str(null, { minLength: 1, maxLength: 200 }),
  start: S.str('Wall-clock start in the timezone, "2026-10-26T08:00"; a date alone for an all-day event or a deadline with no time.', { format: 'local-date-time' }),
  end: S.str('Wall-clock end, same form as start.', { format: 'local-date-time' }),
  timezone: S.str('Where the time is written: America/New_York, Asia/Tokyo. Defaults to this machine\'s zone.', { format: 'timezone' }),
  all_day: S.bool(),
  location: S.str(null, { maxLength: 300 }),
  meeting_url: S.str(null, { maxLength: 1000 }),
  tracker_num: S.tracker('The application it belongs to.'),
  campaign_id: S.int('The campaign it belongs to.', { minimum: 1 }),
  round: S.str('Interview round, e.g. "1st", "final", "1次面接".', { maxLength: 60 }),
  note: S.text(null, 2000),
  source_ref: S.str('An outside reference (an invite email id) so filing it twice updates it.', { maxLength: 300 }),
}, ['kind', 'title', 'start']);

const EVENT = S.any('An event: id, kind, title, starts_at (UTC, or a date when all_day), ends_at, timezone, location, meeting_url, tracker_num, campaign_id, round, done_at, cancelled_at.');

export default [
  {
    name: 'calendar.upcoming',
    kind: 'query',
    summary: 'Interviews, deadlines, follow-ups, and fair days coming up, soonest first. Times are UTC instants with the zone each was written in.',
    permission: 'calendar.read',
    input: S.obj({
      days: S.int(null, { minimum: 1, maximum: 400, default: 30 }),
      kinds: S.arr(S.enum(ev.EVENT_KINDS)),
      campaign_id: S.int(null, { minimum: 1 }),
      tracker_num: S.tracker(),
      include_done: S.bool(null, { default: false }),
    }),
    output: S.obj({ events: S.arr(EVENT) }, ['events']),
    run: ({ root, input }) => ({ events: ev.upcoming(root, { days: input.days, kinds: input.kinds, campaignId: input.campaign_id, trackerNum: input.tracker_num, includeDone: input.include_done }) }),
  },
  {
    name: 'calendar.conflicts',
    kind: 'query',
    summary: 'Before agreeing to a time: what overlaps it, in shukatsu and in connected calendars (classes and exams from Canvas, Google, Outlook), and what sits too close for travel.',
    permission: 'calendar.read',
    input: S.obj({
      start: S.str(null, { format: 'local-date-time' }),
      end: S.str(null, { format: 'local-date-time' }),
      timezone: S.str(null, { format: 'timezone' }),
      gap_minutes: S.int('Flag anything within this many minutes before or after.', { minimum: 0, maximum: 240, default: 30 }),
    }, ['start']),
    output: S.obj({ clear: S.bool(), conflicts: S.arr(S.any()) }, ['clear', 'conflicts']),
    run: async ({ root, input }) => {
      const tz = input.timezone || localZone();
      const probe = ev.eventRow({ kind: 'other', title: 'probe', start: input.start, end: input.end, timezone: tz });
      const from = new Date(Date.parse(probe.all_day ? `${probe.starts_at}T00:00:00Z` : probe.starts_at) - 86_400_000).toISOString();
      const until = new Date(Date.parse(probe.all_day ? `${probe.ends_at || probe.starts_at}T23:59:59Z` : probe.ends_at || probe.starts_at) + 86_400_000).toISOString();
      const busy = await outsideBusy(root, from, until);
      const conflicts = ev.conflicts(root, { start: input.start, end: input.end, timezone: tz, busy, gapMinutes: input.gap_minutes });
      return { clear: !conflicts.some((x) => x.kind === 'overlap'), conflicts };
    },
  },
  {
    name: 'event.create',
    kind: 'command',
    summary: 'Put an interview, deadline, follow-up, or task on the calendar. Check calendar.conflicts first for anything that takes time.',
    permission: 'calendar.write',
    input: EVENT_INPUT,
    output: EVENT,
    activity: (input, out) => ({ verb: 'event.created', subject: `event:${out.id}`, detail: { kind: input.kind, title: input.title, app: input.tracker_num ?? null } }),
    run: ({ root, actor, input }) => ev.createEvent(root, { actor, ...input, timezone: input.timezone || localZone(), source: input.source_ref ? 'agent' : 'shukatsu' }),
  },
  {
    name: 'event.update',
    kind: 'command',
    summary: 'Change an event (a moved interview, a corrected deadline), mark a deadline or task done, or cancel it. Fields left out stay as they are; a cancelled event drops out of subscribed calendars.',
    permission: 'calendar.write',
    input: S.obj({
      id: S.int(null, { minimum: 1 }),
      ...Object.fromEntries(Object.entries(EVENT_INPUT.properties).filter(([k]) => k !== 'source_ref')),
      done: S.bool('Mark done (true) or not done (false).'),
      cancelled: S.bool('Cancel it (true).'),
    }, ['id']),
    output: EVENT,
    activity: (input, out) => ({
      verb: input.cancelled ? 'event.cancelled' : input.done === true ? 'event.done' : 'event.updated',
      subject: `event:${input.id}`, detail: { title: out.title, fields: Object.keys(input).filter((k) => k !== 'id') },
    }),
    run: ({ root, actor, input }) => {
      const { id, done, cancelled, ...fields } = input;
      let out = Object.keys(fields).length ? ev.updateEvent(root, { actor, id, ...fields }) : ev.getEvent(root, id);
      if (!out) throw Object.assign(new Error('No such event.'), { code: 'not_found', status: 404 });
      if (done !== undefined) out = ev.markDone(root, { id, done });
      if (cancelled) out = ev.cancelEvent(root, { id });
      return out;
    },
  },
];
