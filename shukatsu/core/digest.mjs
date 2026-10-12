/**
 * The weekly digest: what happened in the search, for the people following it.
 *
 * The point is to replace "where are you applying, what did you write" with
 * one structured answer a week. It reads only what already exists (tracker,
 * status log, packets, the review queue, the activity log), adds nothing, and
 * leaves out what the reader may not see (compensation, contacts).
 *
 * `digestText(d, lang)` renders it as plain text sized for a chat message, in
 * English or Japanese.
 */

import { readTracker, readPipeline, statusLog } from './tracker.mjs';
import { db } from './store.mjs';
import { summary as reviewSummary } from './review.mjs';
import { owner } from './people.mjs';

const DAY = 86_400_000;
const ACTIVE = new Set(['applied', 'responded', 'interview', 'offer']);

export function digest(root, { days = 7, until = new Date() } = {}) {
  const to = new Date(until);
  const from = new Date(to.getTime() - days * DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  const inRange = (d) => d && d >= iso(from) && d <= iso(to);

  const { rows } = readTracker(root);
  const byNum = new Map(rows.map((r) => [String(r.num), r]));
  const log = statusLog(root);
  const changes = [];
  for (const [num, events] of log) {
    for (const e of events) {
      if (!inRange(e.date)) continue;
      const r = byNum.get(num);
      changes.push({ num: Number(num), company: r?.company || '?', role: r?.role || '', from: e.from, to: e.to, date: e.date });
    }
  }
  changes.sort((a, b) => a.date.localeCompare(b.date));
  const counts = {};
  for (const r of rows) {
    const k = String(r.status || '').toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }

  const packets = db(root).prepare('SELECT id, company, role, status, sent_on, updated_at FROM packets').all();
  const pk = (s) => packets.filter((x) => x.status === s).map(({ id, company, role }) => ({ id, company, role }));

  const acts = db(root).prepare(`SELECT a.verb, a.subject, a.detail, a.created_at, u.name AS actor FROM activity a LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.created_at >= ? AND a.created_at <= ? ORDER BY a.id`).all(from.toISOString(), new Date(to.getTime() + DAY).toISOString());
  const count = (verb) => acts.filter((a) => a.verb === verb).length;
  const contributors = new Map();
  for (const a of acts.filter((x) => ['proposal.created', 'comment.added', 'packet.submitted'].includes(x.verb))) {
    contributors.set(a.actor, (contributors.get(a.actor) || 0) + 1);
  }

  const pipeline = readPipeline(root).filter((x) => x.state === 'pending');
  return {
    period: { from: iso(from), to: iso(to), days },
    candidate: (owner(root)?.name || '').split(' ')[0] || null,
    applications: {
      sent: changes.filter((c) => String(c.to).toLowerCase() === 'applied'),
      movement: changes.filter((c) => String(c.to).toLowerCase() !== 'applied'),
      active: rows.filter((r) => ACTIVE.has(String(r.status).toLowerCase())).length,
      total: rows.length,
      counts,
    },
    packets: { ready: pk('ready'), inReview: pk('in_review'), changes: pk('changes_requested'), drafting: pk('drafting'), sentThisWeek: packets.filter((x) => inRange(x.sent_on)).length },
    review: { ...reviewSummary(root), confirmed: count('review.accept') + count('review.narrative'), rejected: count('review.reject'), unsure: count('review.cannot-confirm') },
    pipeline: { pending: pipeline.length, suggested: count('proposal.created') },
    contributors: [...contributors.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
  };
}

const T = {
  en: {
    title: (d) => `shukatsu, ${d.period.from} to ${d.period.to}`,
    sent: (n) => `Applied: ${n}`,
    moved: 'Movement',
    none: 'No applications went out this week.',
    active: (a, t) => `In play: ${a} of ${t} tracked`,
    ready: (n) => `${n} packet${n === 1 ? '' : 's'} ready to send`,
    inReview: (n, who) => `${n} waiting for ${who ? `${who}'s` : 'the candidate\'s'} review`,
    changes: (n) => `${n} sent back with changes`,
    queue: (n, p) => `Review queue: ${n} item${n === 1 ? '' : 's'}${p ? `, ${p} from people` : ''}`,
    decided: (c, r, u) => `This week: ${c} confirmed, ${r} rejected, ${u} unsure`,
    inbox: (n) => `Postings waiting to be evaluated: ${n}`,
    thanks: (list) => `Help this week: ${list}`,
  },
  ja: {
    title: (d) => `就活レポート ${d.period.from}〜${d.period.to}`,
    sent: (n) => `応募：${n}件`,
    moved: '進捗',
    none: '今週の応募はありません。',
    active: (a, t) => `進行中：${t}件中${a}件`,
    ready: (n) => `送信準備ができた書類：${n}件`,
    // A parent reading this calls the candidate 本人, never by name with さん.
    inReview: (n) => `本人の確認待ち：${n}件`,
    changes: (n) => `修正依頼中：${n}件`,
    queue: (n, p) => `確認キュー：${n}件${p ? `（うち提案${p}件）` : ''}`,
    decided: (c, r, u) => `今週の確認：承認${c}件・却下${r}件・不明${u}件`,
    inbox: (n) => `評価待ちの求人：${n}件`,
    thanks: (list) => `今週のサポート：${list}`,
  },
};

const STATUS_JA = { applied: '応募済み', responded: '返信あり', interview: '面接', offer: '内定', hired: '入社決定', rejected: '不採用', discarded: '見送り', evaluated: '評価済み', skip: '対象外' };

export function digestText(d, lang = 'en') {
  const t = T[lang] || T.en;
  const st = (s) => (lang === 'ja' ? STATUS_JA[String(s).toLowerCase()] || s : s);
  const lines = [t.title(d), ''];
  if (d.applications.sent.length) {
    lines.push(t.sent(d.applications.sent.length));
    for (const a of d.applications.sent) lines.push(`  ${a.company} · ${a.role}`);
  } else lines.push(t.none);
  if (d.applications.movement.length) {
    lines.push('', t.moved);
    for (const m of d.applications.movement) lines.push(`  ${m.company} · ${m.role}: ${st(m.from)} → ${st(m.to)}`);
  }
  lines.push('', t.active(d.applications.active, d.applications.total));
  if (d.packets.ready.length) lines.push(t.ready(d.packets.ready.length));
  if (d.packets.inReview.length) lines.push(t.inReview(d.packets.inReview.length, d.candidate));
  if (d.packets.changes.length) lines.push(t.changes(d.packets.changes.length));
  lines.push(t.queue(d.review.total, d.review.fromPeople));
  if (d.review.confirmed + d.review.rejected + d.review.unsure) lines.push(t.decided(d.review.confirmed, d.review.rejected, d.review.unsure));
  lines.push(t.inbox(d.pipeline.pending));
  if (d.contributors.length) lines.push('', t.thanks(d.contributors.map((c) => `${c.name} (${c.n})`).join(', ')));
  return `${lines.join('\n')}\n`;
}
