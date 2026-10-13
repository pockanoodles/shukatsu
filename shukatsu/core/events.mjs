/**
 * The one calendar: interviews, deadlines, follow-ups, fair days, and
 * campaign slots, in app.db's `events` table.
 *
 * Each event keeps the instant it happens (UTC) and the timezone it was
 * written in, because a deadline posted in JST and read in ET is the easiest
 * one to miss. An all-day event keeps its date as written, with no instant.
 *
 * Outside calendars (Canvas, Google, Outlook) never land here: they live in
 * sync.db as copies, and only count as busy time when checking a conflict.
 */

import { db, now } from './store.mjs';
import { validZone, zonedToUtc } from './tz.mjs';

export const EVENT_KINDS = ['interview', 'deadline', 'followup', 'fair', 'task', 'other'];
const COLS = ['kind', 'title', 'starts_at', 'ends_at', 'all_day', 'timezone', 'location', 'meeting_url', 'tracker_num', 'campaign_id', 'round', 'source', 'source_ref', 'note'];

const clean = (s, max = 300) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, max) || null);

/**
 * Normalize what a person or agent typed into a row. `start` and `end` are
 * wall-clock times in `timezone` ("2026-10-26T08:00"), or dates for an
 * all-day event; an ISO instant with an offset is taken as is.
 */
export function eventRow(input) {
  const tz = input.timezone;
  if (!validZone(tz)) throw new Error(`"${tz}" isn't a timezone. Use a name like America/New_York or Asia/Tokyo.`);
  if (!EVENT_KINDS.includes(input.kind)) throw new Error(`An event is one of ${EVENT_KINDS.join(', ')}.`);
  const allDay = Boolean(input.all_day) || /^\d{4}-\d{2}-\d{2}$/.test(input.start);
  const at = (v) => {
    if (v == null || v === '') return null;
    if (allDay) return String(v).slice(0, 10);
    return /[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? new Date(v).toISOString().replace(/\.000Z$/, 'Z') : zonedToUtc(v, tz);
  };
  const starts = at(input.start);
  const ends = at(input.end);
  if (!starts) throw new Error('An event needs a start.');
  if (ends && ends < starts) throw new Error('The event ends before it starts.');
  const title = clean(input.title, 200);
  if (!title) throw new Error('An event needs a title.');
  return {
    kind: input.kind, title, starts_at: starts, ends_at: ends, all_day: allDay ? 1 : 0, timezone: tz,
    location: clean(input.location), meeting_url: clean(input.meeting_url, 1000), tracker_num: input.tracker_num ?? null,
    campaign_id: input.campaign_id ?? null, round: clean(input.round, 60), source: clean(input.source, 40) || 'shukatsu',
    source_ref: clean(input.source_ref, 300), note: clean(input.note, 2000),
  };
}

export function createEvent(root, { actor, ...input }) {
  const row = eventRow(input);
  const t = now();
  const d = db(root);
  if (row.source_ref) {
    // One event per outside reference (an invite email, a feed UID): a re-run updates it.
    const hit = d.prepare('SELECT id FROM events WHERE source = ? AND source_ref = ?').get(row.source, row.source_ref);
    if (hit) return updateEvent(root, { actor, id: hit.id, ...input });
  }
  const r = d.prepare(`INSERT INTO events (${COLS.join(', ')}, created_by, created_at, updated_at) VALUES (${COLS.map(() => '?').join(', ')}, ?, ?, ?)`)
    .run(...COLS.map((c) => row[c]), actor?.id ?? null, t, t);
  return getEvent(root, Number(r.lastInsertRowid));
}

export function updateEvent(root, { actor: _actor, id, ...input }) {
  const cur = getEvent(root, id);
  if (!cur) throw new Error('No such event.');
  const merged = {
    kind: cur.kind, title: cur.title, timezone: cur.timezone, all_day: cur.all_day,
    start: cur.all_day ? cur.starts_at : cur.starts_at, end: cur.ends_at, location: cur.location, meeting_url: cur.meeting_url,
    tracker_num: cur.tracker_num, campaign_id: cur.campaign_id, round: cur.round, source: cur.source, source_ref: cur.source_ref, note: cur.note,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  };
  // Times re-read in the (possibly new) zone only when they were given again.
  if (input.start === undefined && input.timezone !== undefined && !cur.all_day) merged.start = cur.starts_at;
  const row = eventRow(merged);
  db(root).prepare(`UPDATE events SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, cancelled_at = NULL WHERE id = ?`).run(...COLS.map((c) => row[c]), now(), id);
  return getEvent(root, id);
}

export const getEvent = (root, id) => db(root).prepare('SELECT * FROM events WHERE id = ?').get(id) || null;

export function cancelEvent(root, { id }) {
  if (!getEvent(root, id)) throw new Error('No such event.');
  db(root).prepare('UPDATE events SET cancelled_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return getEvent(root, id);
}

export function markDone(root, { id, done = true }) {
  if (!getEvent(root, id)) throw new Error('No such event.');
  db(root).prepare('UPDATE events SET done_at = ?, updated_at = ? WHERE id = ?').run(done ? now() : null, now(), id);
  return getEvent(root, id);
}

/**
 * Events from `from` for `days`, soonest first. An all-day event counts on
 * its date; a timed one by its instant.
 */
export function upcoming(root, { from = new Date().toISOString(), days = 30, kinds = null, campaignId = null, trackerNum = null, includeDone = false, includeCancelled = false } = {}) {
  const until = new Date(Date.parse(from) + days * 86_400_000).toISOString();
  const where = ['((all_day = 0 AND COALESCE(ends_at, starts_at) >= ? AND starts_at < ?) OR (all_day = 1 AND COALESCE(ends_at, starts_at) >= ? AND starts_at <= ?))'];
  const args = [from, until, from.slice(0, 10), until.slice(0, 10)];
  if (!includeCancelled) where.push('cancelled_at IS NULL');
  if (!includeDone) where.push('done_at IS NULL');
  if (kinds?.length) { where.push(`kind IN (${kinds.map(() => '?').join(', ')})`); args.push(...kinds); }
  if (campaignId) { where.push('campaign_id = ?'); args.push(campaignId); }
  if (trackerNum) { where.push('tracker_num = ?'); args.push(trackerNum); }
  return db(root).prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY starts_at, id`).all(...args);
}

/** Every event for a feed: the last 60 days onward, cancelled ones included so subscribers drop them. */
export const feedEvents = (root) => db(root).prepare('SELECT * FROM events WHERE COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at')
  .all(new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10));

const span = (e) => {
  if (e.all_day) {
    const start = Date.parse(`${e.starts_at}T00:00:00Z`);
    const end = Date.parse(`${(e.ends_at || e.starts_at)}T00:00:00Z`) + 86_400_000;
    return [start, end];
  }
  const start = Date.parse(e.starts_at);
  return [start, e.ends_at ? Date.parse(e.ends_at) : start + 3_600_000];
};

/**
 * What overlaps a proposed time: shukatsu's own events, and busy time from
 * any outside calendar a connector supplies (`busy` is a list of
 * { title, starts_at, ends_at, all_day, source }). `gapMinutes` flags events
 * that end too close before or start too close after, for travel between
 * fair booths or campuses. Deadlines don't block time, so they never conflict;
 * an outside one comes back as `due` so the candidate sees what else is due that day.
 */
export function conflicts(root, { start, end, timezone, busy = [], gapMinutes = 0, ignoreId = null }) {
  const probe = eventRow({ kind: 'other', title: 'probe', start, end, timezone });
  const [s, e] = span(probe);
  const gap = gapMinutes * 60_000;
  const ours = upcoming(root, { from: new Date(s - 86_400_000).toISOString(), days: Math.ceil((e - s) / 86_400_000) + 2 })
    .filter((x) => x.kind !== 'deadline' && x.id !== ignoreId).map((x) => ({ ...x, source: x.source || 'shukatsu' }));
  const out = [];
  // An outside due date (a Canvas assignment) takes no time, so it's reported as "due that day", never as an overlap.
  for (const x of busy.filter((b) => b.kind === 'deadline')) {
    const [xs, xe] = span(x);
    if (xs < e + 86_400_000 && xe > s - 86_400_000) out.push({ kind: 'due', event: x });
  }
  for (const x of [...ours, ...busy.filter((b) => b.kind !== 'deadline')]) {
    const [xs, xe] = span(x);
    if (xs < e && xe > s) out.push({ kind: 'overlap', event: x });
    else if (gap && ((xe <= s && s - xe < gap) || (xs >= e && xs - e < gap))) out.push({ kind: 'tight', event: x, minutes: Math.round(Math.min(Math.abs(s - xe), Math.abs(xs - e)) / 60000) });
  }
  return out;
}
