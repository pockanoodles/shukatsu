/**
 * /cal/{token}.ics: a private calendar feed. The token is a 'feed' token
 * (core/people.mjs), made for the owner or for one family member, so each
 * subscriber can be cut off alone. A wrong token gets the same 404 as a
 * missing feed, and repeated misses from one address are slowed down.
 */

import { tokenUser } from './people.mjs';
import { feedEvents } from './events.mjs';
import { renderCalendar } from './ics.mjs';

export function handleCal(req, res, ctx) {
  const m = new URL(req.url, 'http://x').pathname.match(/^\/cal\/(shk_feed_[\w-]+)\.ics$/);
  if (!m || !['GET', 'HEAD'].includes(req.method)) return false;
  const hit = tokenUser(ctx.root, m[1], { ip: ctx.ip, kinds: ['feed'] });
  if (!hit || hit.user.kind !== 'person') {
    const slow = ctx.limited(`cal-miss:${ctx.ip}`, 30, 15 * 60_000);
    ctx.send(slow ? 429 : 404, slow ? 'Too many requests.' : 'No such calendar.', { 'Content-Type': 'text/plain; charset=utf-8', ...(slow ? { 'Retry-After': '900' } : {}) });
    return true;
  }
  const audience = hit.user.role === 'owner' ? 'owner' : 'family';
  const body = renderCalendar(feedEvents(ctx.root), {
    name: audience === 'owner' ? 'shukatsu' : `shukatsu (${hit.user.name})`, host: new URL(ctx.baseUrl).hostname, audience,
  });
  ctx.send(200, req.method === 'HEAD' ? '' : body, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="shukatsu.ics"',
    'Cache-Control': 'private, max-age=300',
  });
  return true;
}
