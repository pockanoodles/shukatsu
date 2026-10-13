/**
 * Campaigns: a career fair or hiring cycle, holding its applications, its
 * deadlines, and its slots together. See core/campaigns.mjs.
 */

import * as c from '../campaigns.mjs';
import { listPackets } from '../packets.mjs';
import { S } from './schema.mjs';
import { EVENT_INPUT } from './schedule.mjs';

const ID = S.int('The campaign id.', { minimum: 1 });
const FIELDS = {
  name: S.str(null, { minLength: 1, maxLength: 120 }),
  kind: S.enum(['fair', 'cycle'], 'fair = a career fair with fair days; cycle = a recruiting season with no venue.'),
  url: S.str('The fair\'s or cycle\'s page.', { maxLength: 1000 }),
  venue: S.str(null, { maxLength: 200 }),
  timezone: S.str('Where its times are written, e.g. America/New_York. Deadlines and slots default to it.', { format: 'timezone' }),
  starts_on: S.date(),
  ends_on: S.date(),
  notes: S.text(null, 4000),
};

/** Packet readiness per tracker row, for the campaign page (Japanese packets: every fact confirmed in Japanese). */
function packetsByRow(root) {
  const out = new Map();
  for (const pk of listPackets(root)) {
    if (!pk.tracker_num || ['closed'].includes(pk.status)) continue;
    const prev = out.get(pk.tracker_num);
    if (!prev || pk.updated_at > prev.updated_at) out.set(pk.tracker_num, { id: pk.id, status: pk.status, lang: pk.lang, updated_at: pk.updated_at });
  }
  return out;
}

export default [
  {
    name: 'campaign.list',
    kind: 'query',
    summary: 'Career fairs and hiring cycles, with how many applications each holds and its next open deadline.',
    permission: 'view',
    input: S.obj({ archived: S.bool(null, { default: false }) }),
    output: S.obj({ campaigns: S.arr(S.any()) }, ['campaigns']),
    run: ({ root, input }) => ({ campaigns: c.listCampaigns(root, input) }),
  },
  {
    name: 'campaign.get',
    kind: 'query',
    summary: 'One campaign: every linked application with its tracker status, channel, packet, next deadline, and slots; plus its deadlines, fair days, and interview slots.',
    permission: 'view',
    input: S.obj({ id: ID }, ['id']),
    output: S.any(),
    run: ({ root, input }) => {
      const out = c.campaign(root, input.id, { packets: packetsByRow(root) });
      if (!out) throw Object.assign(new Error('No such campaign.'), { code: 'not_found', status: 404 });
      return out;
    },
  },
  {
    name: 'campaign.create',
    kind: 'command',
    summary: 'Start a campaign (a recurring career fair, or a hiring cycle). Or copy last year\'s with copy_from: same venue and notes, dates cleared, no applications.',
    permission: 'campaign.write',
    input: S.obj({ ...FIELDS, copy_from: S.int('Copy this campaign.', { minimum: 1 }) }, ['name']),
    output: S.obj({ id: S.int() }, ['id']),
    activity: (input, out) => ({ verb: 'campaign.created', subject: `campaign:${out.id}`, detail: { name: input.name } }),
    run: ({ root, actor, input }) => {
      const { copy_from: from, ...fields } = input;
      if (from) {
        const copy = c.copyCampaign(root, { actor, id: from, name: fields.name });
        const rest = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'name'));
        return { id: (Object.keys(rest).length ? c.updateCampaign(root, { id: copy.id, changes: rest }) : copy).id };
      }
      return { id: c.createCampaign(root, { actor, ...fields }).id };
    },
  },
  {
    name: 'campaign.update',
    kind: 'command',
    summary: 'Change a campaign\'s name, dates, venue, timezone, or notes; or archive it when the cycle is over.',
    permission: 'campaign.write',
    input: S.obj({ id: ID, ...FIELDS, archived: S.bool() }, ['id']),
    output: S.any(),
    activity: (input) => ({ verb: 'campaign.updated', subject: `campaign:${input.id}`, detail: { fields: Object.keys(input).filter((k) => k !== 'id') } }),
    run: ({ root, input }) => {
      const { id, archived, ...changes } = input;
      if (archived !== undefined) c.archiveCampaign(root, { id, archived });
      return c.updateCampaign(root, { id, changes });
    },
  },
  {
    name: 'campaign.link',
    kind: 'command',
    summary: 'Add tracker rows to a campaign with the channel each went through (the fair site, the employer\'s ATS), or take them out with remove.',
    permission: 'campaign.write',
    input: S.obj({
      id: ID,
      rows: S.arr(S.obj({ tracker_num: S.tracker(), channel: S.str('e.g. CareerForum.Net, Avature, Workday, Handshake.', { maxLength: 80 }), note: S.str(null, { maxLength: 500 }) }, ['tracker_num']), null, { minItems: 1, maxItems: 100 }),
      remove: S.bool(null, { default: false }),
    }, ['id', 'rows']),
    output: S.any(),
    activity: (input) => ({ verb: input.remove ? 'campaign.unlinked' : 'campaign.linked', subject: `campaign:${input.id}`, detail: { rows: input.rows.map((r) => r.tracker_num) } }),
    run: ({ root, actor, input }) => c.linkRows(root, { actor, ...input }),
  },
  {
    name: 'campaign.schedule',
    kind: 'command',
    summary: 'Add a deadline, a fair day, or an interview slot to a campaign. Times are wall-clock in the given timezone (default: the campaign\'s), e.g. a pre-application deadline written in JST stays in JST.',
    permission: 'campaign.write',
    input: S.obj({ id: ID, ...EVENT_INPUT.properties, kind: S.enum(['deadline', 'fair', 'interview', 'followup', 'task', 'other']), timezone: S.str(null, { format: 'timezone' }) }, ['id', 'kind', 'title', 'start']),
    output: S.any(),
    activity: (input, out) => ({ verb: 'event.created', subject: `event:${out.id}`, detail: { kind: input.kind, campaign: input.id, title: input.title } }),
    run: ({ root, actor, input }) => c.addCampaignEvent(root, { actor, ...input }),
  },
];
