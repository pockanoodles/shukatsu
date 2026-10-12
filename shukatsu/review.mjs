#!/usr/bin/env node

/**
 * review.mjs -- the review queue from the terminal. Same queue, same outcomes,
 * same write path as the app's Review page (core/review.mjs).
 *
 *   node shukatsu/review.mjs                         # list what's waiting
 *   node shukatsu/review.mjs show <key>
 *   node shukatsu/review.mjs accept <key> [--text "edited wording"]
 *   node shukatsu/review.mjs narrative <key> --text "wording without the figure"
 *   node shukatsu/review.mjs unsure <key> [--reason "..."]     # "I don't know"
 *   node shukatsu/review.mjs reject <key> --reason "..."
 *   node shukatsu/review.mjs reopen <key>
 *   node shukatsu/review.mjs decided
 *   node shukatsu/review.mjs --json                  # the queue as JSON
 *
 * Keys look like draft:fact:foresight.cache, draft:ja:cmt.audit,
 * draft:variant:foresight.dial-volume/tooling, proposal:12, packet:3.
 * Decisions are made as the owner (create one with `people.mjs init`).
 */

import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { decide, decided, item, queue, reopen } from './core/review.mjs';
import { owner } from './core/people.mjs';
import { numbers } from './core/facts.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}

const KIND = {
  entity: 'role', fact: 'fact', variant: 'variant', ja: 'japanese', packet: 'packet',
  'proposal.fact.edit': 'edit', 'proposal.fact.new': 'new fact', 'proposal.fact.retire': 'retire',
  'proposal.entity.new': 'new role', 'proposal.posting': 'posting',
};

function show(it) {
  console.log(`${it.key}  (${KIND[it.kind] || it.kind}${it.author ? `, from ${it.author.name}` : ', drafted from sources'})`);
  if (it.entity) console.log(`  ${it.entity.heading || it.entity.label}${it.entity.title ? ` | ${it.entity.title}` : ''}${it.entity.dates ? ` | ${it.entity.dates}` : ''}`);
  if (it.before && it.before !== it.after) console.log(`  before  ${it.before}`);
  if (it.after) console.log(`  ${it.before ? 'after ' : 'text  '}  ${it.after}`);
  if (it.evidence?.quote) console.log(`  evidence  ${it.evidence.source}${it.evidence.line ? `:${it.evidence.line}` : ''}  "${it.evidence.quote}"`);
  if (it.fact?.provenance) console.log(`  provenance ${it.fact.provenance}`);
  if (it.note) console.log(`  note    ${it.note}`);
  for (const w of it.warnings) console.log(`  warn    ${w.code}${w.diff ? ` (+${w.diff.added.join(',') || '-'} / -${w.diff.removed.join(',') || '-'})` : ''}${w.entity ? ` (${w.entity})` : ''}`);
  for (const c of it.checks) console.log(`  ${c.severity.padEnd(5)}   ${c.rule}: ${c.message}`);
  if (it.hasNumbers) console.log(`  figures [${numbers(it.after).join(', ')}]: accept, accept --text (corrected), narrative --text, or unsure`);
}

function cli(argv) {
  const root = getCareerOpsRoot();
  const a = args(argv);
  const [cmd, key] = a._;
  if (!cmd || cmd === 'list') {
    const q = queue(root);
    if (a.json) { console.log(JSON.stringify(q, null, 2)); return 0; }
    let group = null;
    for (const it of q) {
      const g = it.source === 'profile' ? (it.entity?.label || 'profile') : 'From people';
      if (g !== group) { console.log(`\n${g}`); group = g; }
      const text = (it.after || '').length > 96 ? `${it.after.slice(0, 95)}…` : it.after;
      console.log(`  ${it.key.padEnd(46)} ${text}`);
    }
    console.log(`\n${q.length} waiting. Show one with: node shukatsu/review.mjs show <key>`);
    return 0;
  }
  if (cmd === 'decided') {
    const d = decided(root);
    for (const x of d.drafts) console.log(`${x.status.padEnd(15)} ${x.key.padEnd(46)} ${x.decided_on || ''}  ${x.reason || ''}`);
    for (const pr of d.proposals.slice(0, 20)) console.log(`${pr.status.padEnd(15)} proposal:${String(pr.id).padEnd(37)} ${pr.kind} from ${pr.author_name}`);
    return 0;
  }
  if (!key) throw new Error(`${cmd} needs an item key`);
  if (cmd === 'show') {
    const it = item(root, key);
    if (!it) throw new Error(`Nothing waiting at ${key}`);
    show(it);
    return 0;
  }
  const actor = owner(root);
  if (!actor) throw new Error('No owner yet. Create one first: node shukatsu/people.mjs init --name "Your Name"');
  if (cmd === 'reopen') { reopen(root, { actor, key }); console.log(`${key} is back in the queue.`); return 0; }
  const outcome = { accept: 'accept', narrative: 'narrative', unsure: 'cannot-confirm', reject: 'reject' }[cmd];
  if (!outcome) throw new Error(`Unknown command "${cmd}"`);
  const r = decide(root, { actor, key, outcome, text: typeof a.text === 'string' ? a.text : null, reason: typeof a.reason === 'string' ? a.reason : '' });
  console.log(`${cmd}: ${key}${r.commit?.committed ? ` (commit ${r.commit.sha})` : ''}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  try { process.exitCode = cli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
