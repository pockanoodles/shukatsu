/**
 * Pick the facts a tailored resume carries.
 *
 * Deterministic and zero-token: each live fact scores by the archetype's tags
 * (strongest first), the JD's distinctive words, and its priority, then the
 * one-page budget in the profile's `select:` block decides how many survive.
 * Judgment (an LLM re-rank, or the candidate swapping a fact in by hand) sits
 * on top of this; the budget, caps, `always`, and live-only rules never move.
 */

import { BULLET_SECTIONS, JD_GENERIC, entityLive, isLive, tokens } from './facts.mjs';

export function scoreFact(f, e, arch, jd) {
  let s = 0;
  const why = [];
  const tags = f.tags || e?.tags || [];
  arch.tags.forEach((t, i) => { if (tags.includes(t)) { s += 3 - i; why.push(`${t}+${3 - i}`); } });
  if (jd.size) {
    const hits = [...tokens(f.text)].filter((w) => jd.has(w) && !JD_GENERIC.has(w));
    const k = Math.min(hits.length, 4);
    if (k) { s += k; why.push(`jd+${k} (${hits.slice(0, 4).join(', ')})`); }
  }
  const pr = f.priority ?? 2;
  s += (3 - pr) * 1.5;
  if (pr !== 2) why.push(`priority ${pr}`);
  if (f.pin) { s += 100; why.push('pinned'); }
  return { score: Math.round(s * 10) / 10, why: why.join(', ') };
}

/** Candidate facts for an archetype, each with its score and chosen variant. */
export function candidates(p, archetype, jdText = '') {
  const arch = p.archetypes?.[archetype];
  if (!arch) throw new Error(`Unknown archetype "${archetype}". Known: ${Object.keys(p.archetypes || {}).join(', ')}`);
  const jd = jdText ? tokens(jdText) : new Set();
  const out = [];
  for (const e of p._entities.filter((x) => BULLET_SECTIONS.has(x.section) && entityLive(x))) {
    for (const f of (e.facts || []).filter(isLive)) {
      const v = (f.variants || []).find((x) => isLive(x) && (x.for || []).includes(archetype));
      out.push({ e, f, variant: v?.key || null, ...scoreFact(f, e, arch, jd) });
    }
  }
  return out;
}

/**
 * `force` (fact IDs) are taken before scoring order, inside the caps; `drop`
 * (fact IDs) are never taken. Both are how a person overrides the ranking
 * without being able to break the budget.
 */
export function select(p, { archetype, jdText = '', force = [], drop = [] }) {
  const cfg = p.select || {};
  const cands = candidates(p, archetype, jdText).filter((c) => !drop.includes(c.f.id));

  const entityScore = new Map();
  for (const e of new Set(cands.map((c) => c.e))) {
    const top = cands.filter((c) => c.e === e).map((c) => c.score).sort((a, b) => b - a).slice(0, 2);
    entityScore.set(e, top.reduce((a, b) => a + b, 0) + (e.always ? 1000 : 0) + (cands.some((c) => c.e === e && force.includes(c.f.id)) ? 500 : 0));
  }
  const ranked = (section) => [...entityScore.keys()].filter((e) => e.section === section)
    .sort((a, b) => entityScore.get(b) - entityScore.get(a));

  const caps = new Map();
  ranked('work').forEach((e, i) => caps.set(e, i === 0 ? cfg.main_role_max ?? 5 : cfg.minor_role_max ?? 2));
  ranked('projects').forEach((e, i) => caps.set(e, i < (cfg.projects_max ?? 2) || e.always ? cfg.project_bullets_max ?? 3 : 0));
  ranked('volunteering').forEach((e) => caps.set(e, cfg.volunteering_max ?? 1));

  const chosen = new Map();
  let total = 0;
  const budget = cfg.max_bullets ?? 14;
  const take = (c) => {
    const list = chosen.get(c.e) || [];
    if (list.length >= (caps.get(c.e) ?? 0) || list.includes(c)) return false;
    chosen.set(c.e, [...list, c]);
    total++;
    return true;
  };
  const byScore = [...cands].sort((a, b) => b.score - a.score);
  for (const c of byScore.filter((x) => force.includes(x.f.id))) if (total < budget) take(c);
  // An always-shown entity gets its best fact first, so the budget can't starve it.
  for (const e of [...entityScore.keys()].filter((x) => x.always)) {
    if (chosen.has(e)) continue;
    const best = byScore.find((c) => c.e === e);
    if (best) take(best);
  }
  for (const c of byScore) if (total < budget) take(c);

  const pick = new Map();
  const manifest = [];
  for (const e of p._entities) {
    const list = (chosen.get(e) || []).sort((a, b) => b.score - a.score);
    if (!list.length) continue;
    pick.set(e.id, list.map((c) => ({ id: c.f.id, variant: c.variant })));
    manifest.push({ entity: e.id, facts: list.map((c) => ({ id: c.f.id, variant: c.variant, score: c.score, why: c.why })) });
  }
  const left = cands.filter((c) => !(chosen.get(c.e) || []).includes(c))
    .sort((a, b) => b.score - a.score).map((c) => ({ id: c.f.id, entity: c.e.id, score: c.score, why: c.why }));
  const summary = (p.summary || []).filter(isLive).find((s) => (s.archetypes || []).includes(archetype));
  return { pick, manifest, left, summaryId: summary?.id || null, total, budget };
}
