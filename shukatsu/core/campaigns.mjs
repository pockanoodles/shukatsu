/**
 * Campaigns: a recurring career fair (or any hiring cycle) as one thing.
 *
 * A fair runs as online pre-applications with their own deadlines, invites to
 * interview by email, interviews packed into the fair days, and follow-ups
 * afterward. A campaign groups the tracker rows in that cycle (with the
 * channel each went through: the fair site, the employer's ATS) and owns the
 * events that schedule it, which live in the one calendar (core/events.mjs).
 *
 * The tracker stays the source of truth for where each application stands.
 * A campaign only groups and schedules rows, so upstream tools keep working on
 * the tracker unchanged.
 */

import { db, now, tx } from './store.mjs';
import { readTracker } from './tracker.mjs';
import { createEvent, upcoming } from './events.mjs';
import { validZone } from './tz.mjs';

const clean = (s, max = 300) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, max) || null);

export const listCampaigns = (root, { archived = false } = {}) => db(root).prepare(`SELECT c.*, (SELECT COUNT(*) FROM campaign_rows r WHERE r.campaign_id = c.id) AS rows,
  (SELECT MIN(e.starts_at) FROM events e WHERE e.campaign_id = c.id AND e.kind = 'deadline' AND e.done_at IS NULL AND e.cancelled_at IS NULL AND e.starts_at >= ?) AS next_deadline
  FROM campaigns c WHERE ${archived ? '1' : 'c.archived_at IS NULL'} ORDER BY COALESCE(c.starts_on, c.created_at) DESC`).all(new Date().toISOString().slice(0, 10));

export const getCampaignRow = (root, id) => db(root).prepare('SELECT * FROM campaigns WHERE id = ?').get(id) || null;

export function createCampaign(root, { actor, name, kind = 'fair', url = null, venue = null, timezone = 'America/New_York', starts_on = null, ends_on = null, notes = null }) {
  if (!clean(name)) throw new Error('A campaign needs a name.');
  if (!validZone(timezone)) throw new Error(`"${timezone}" isn't a timezone.`);
  if (starts_on && ends_on && ends_on < starts_on) throw new Error('The campaign ends before it starts.');
  const t = now();
  const r = db(root).prepare(`INSERT INTO campaigns (name, kind, url, venue, timezone, starts_on, ends_on, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(clean(name, 120), kind, clean(url, 1000), clean(venue), timezone, starts_on, ends_on, clean(notes, 4000), actor?.id ?? null, t, t);
  return getCampaignRow(root, Number(r.lastInsertRowid));
}

const FIELDS = ['name', 'kind', 'url', 'venue', 'timezone', 'starts_on', 'ends_on', 'notes'];

export function updateCampaign(root, { id, changes }) {
  const cur = getCampaignRow(root, id);
  if (!cur) throw new Error('No such campaign.');
  const sets = Object.entries(changes).filter(([k, v]) => FIELDS.includes(k) && v !== undefined);
  if (changes.timezone && !validZone(changes.timezone)) throw new Error(`"${changes.timezone}" isn't a timezone.`);
  if (!sets.length) return cur;
  db(root).prepare(`UPDATE campaigns SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...sets.map(([k, v]) => (['name', 'venue', 'url', 'notes'].includes(k) ? clean(v, k === 'notes' ? 4000 : 1000) : v)), now(), id);
  return getCampaignRow(root, id);
}

export function archiveCampaign(root, { id, archived = true }) {
  if (!getCampaignRow(root, id)) throw new Error('No such campaign.');
  db(root).prepare('UPDATE campaigns SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id);
  return getCampaignRow(root, id);
}

/** Link tracker rows to a campaign (or unlink with `remove`). Rows must exist in the tracker. */
export function linkRows(root, { actor, id, rows, remove = false }) {
  if (!getCampaignRow(root, id)) throw new Error('No such campaign.');
  const known = new Set(readTracker(root).rows.map((r) => r.num));
  const missing = rows.filter((r) => !remove && !known.has(r.tracker_num)).map((r) => r.tracker_num);
  if (missing.length) throw new Error(`Not in the tracker: #${missing.join(', #')}. Add the application first (tracker.add or evaluation.file).`);
  tx(root, (d) => {
    for (const r of rows) {
      if (remove) d.prepare('DELETE FROM campaign_rows WHERE campaign_id = ? AND tracker_num = ?').run(id, r.tracker_num);
      else d.prepare(`INSERT INTO campaign_rows (campaign_id, tracker_num, channel, note, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (campaign_id, tracker_num) DO UPDATE SET channel = COALESCE(excluded.channel, channel), note = COALESCE(excluded.note, note)`)
        .run(id, r.tracker_num, clean(r.channel, 80), clean(r.note, 500), actor?.id ?? null, now());
    }
  });
  return campaign(root, id);
}

/**
 * A campaign with everything the campaign page and an agent need: its rows
 * joined to the tracker, its deadlines and slots, and per-row readiness.
 * `packets` maps tracker num -> { status, lang, jaReady } when known.
 */
export function campaign(root, id, { packets = new Map() } = {}) {
  const c = getCampaignRow(root, id);
  if (!c) return null;
  const tracker = new Map(readTracker(root).rows.map((r) => [r.num, r]));
  const events = upcoming(root, { from: '1970-01-01T00:00:00Z', days: 365 * 200, campaignId: id, includeDone: true });
  const rows = db(root).prepare('SELECT * FROM campaign_rows WHERE campaign_id = ? ORDER BY added_at').all(id).map((r) => {
    const t = tracker.get(r.tracker_num);
    const mine = events.filter((e) => e.tracker_num === r.tracker_num && !e.cancelled_at);
    return {
      tracker_num: r.tracker_num, channel: r.channel, note: r.note,
      company: t?.company ?? null, role: t?.role ?? null, status: t?.status ?? null, score: t?.score ?? null, missing: !t,
      next_deadline: mine.filter((e) => e.kind === 'deadline' && !e.done_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null,
      slots: mine.filter((e) => e.kind === 'interview'),
      packet: packets.get(r.tracker_num) || null,
    };
  });
  return {
    ...c,
    rows,
    deadlines: events.filter((e) => e.kind === 'deadline'),
    slots: events.filter((e) => e.kind === 'interview'),
    days: events.filter((e) => e.kind === 'fair'),
    other: events.filter((e) => !['deadline', 'interview', 'fair'].includes(e.kind)),
  };
}

/**
 * Next year's fair as a copy of this one: same name pattern, venue, channel
 * per company, and deadline kinds, with every date cleared and no rows (the
 * tracker rows belong to last year's applications).
 */
export function copyCampaign(root, { actor, id, name }) {
  const c = getCampaignRow(root, id);
  if (!c) throw new Error('No such campaign.');
  const next = createCampaign(root, { actor, name: name || `${c.name} (copy)`, kind: c.kind, url: c.url, venue: c.venue, timezone: c.timezone, notes: c.notes });
  db(root).prepare('UPDATE campaigns SET copied_from = ? WHERE id = ?').run(id, next.id);
  return getCampaignRow(root, next.id);
}

/** A fair day or a deadline or a slot, tied to this campaign, in its timezone unless one is given. */
export function addCampaignEvent(root, { actor, id, ...event }) {
  const c = getCampaignRow(root, id);
  if (!c) throw new Error('No such campaign.');
  return createEvent(root, { actor, ...event, timezone: event.timezone || c.timezone, campaign_id: id });
}
