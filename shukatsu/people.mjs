#!/usr/bin/env node

/**
 * people.mjs -- who can use this install, from the terminal.
 *
 *   node shukatsu/people.mjs init --name "Sam Candidate" [--lang en]
 *        The first run on a new server: prints a one-time link that creates the
 *        owner. There is no public sign-up page, so this is the only way in.
 *   node shukatsu/people.mjs invite --name "Mom" --role editor [--relation Mother] [--lang ja] [--days 7]
 *   node shukatsu/people.mjs reset <login>       # a fresh sign-in link for someone locked out
 *   node shukatsu/people.mjs list
 *   node shukatsu/people.mjs disable <login>
 *
 * Links are printed against SHUKATSU_URL (default http://localhost:3000).
 * Each link works once and expires (7 days by default).
 */

import { getCareerOpsRoot } from '../path-resolver.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { PERSON_ROLES, createInvite, hasOwner, listUsers, openInvites, owner } from './core/people.mjs';
import { callOp } from './core/client.mjs';

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

const base = () => (process.env.SHUKATSU_URL || 'http://localhost:3000').replace(/\/$/, '');
const link = (token) => `${base()}/invite/${token}`;

async function cli(argv) {
  const root = getCareerOpsRoot();
  const a = args(argv);
  const [cmd, target] = a._;
  if (cmd === 'init') {
    if (hasOwner(root)) throw new Error('This install already has an owner. Use `invite` or `reset`.');
    if (!a.name) throw new Error('init needs --name');
    const token = createInvite(root, { actor: null, role: 'owner', name: String(a.name), lang: a.lang === 'ja' ? 'ja' : 'en', days: 1 });
    console.log(`Open this within 24 hours to create the owner account:\n\n  ${link(token)}\n`);
    return 0;
  }
  if (!owner(root)) throw new Error('No owner yet. Run: node shukatsu/people.mjs init --name "Your Name"');
  if (cmd === 'invite') {
    if (!a.name) throw new Error('invite needs --name');
    const role = String(a.role || 'reviewer');
    if (!PERSON_ROLES.includes(role) || role === 'owner') throw new Error(`--role is one of ${PERSON_ROLES.filter((r) => r !== 'owner').join(', ')}`);
    const { token } = await callOp(root, 'people.invite', { name: String(a.name), role, ...(a.relation ? { relation: String(a.relation) } : {}), lang: a.lang === 'ja' ? 'ja' : 'en', days: Number(a.days) || 7 });
    console.log(`Send this to ${a.name} (${role}). It works once:\n\n  ${link(token)}\n`);
    return 0;
  }
  if (cmd === 'reset') {
    const user = listUsers(root).find((u) => u.login.toLowerCase() === String(target || '').toLowerCase());
    if (!user) throw new Error(`No one signs in as "${target}"`);
    const { token } = await callOp(root, 'people.reset', { id: user.id });
    console.log(`A new sign-in link for ${user.name}. It works once, for 48 hours, and signs out their other sessions:\n\n  ${link(token)}\n`);
    return 0;
  }
  if (cmd === 'disable') {
    const user = listUsers(root).find((u) => u.login.toLowerCase() === String(target || '').toLowerCase());
    if (!user) throw new Error(`No one signs in as "${target}"`);
    await callOp(root, 'people.disable', { id: user.id });
    console.log(`${user.name} is disabled and signed out everywhere.`);
    return 0;
  }
  if (!cmd || cmd === 'list') {
    for (const u of listUsers(root)) {
      console.log(`${u.role.padEnd(9)} ${u.login.padEnd(16)} ${u.name}${u.relation ? ` (${u.relation})` : ''}${u.disabled_at ? '  [disabled]' : ''}  last seen ${u.last_seen_at?.slice(0, 16) || 'never'}`);
    }
    for (const i of openInvites(root)) console.log(`invited   ${''.padEnd(16)} ${i.name} as ${i.role}, expires ${i.expires_at.slice(0, 10)}`);
    return 0;
  }
  throw new Error(`Unknown command "${cmd}"`);
}

if (isMainModule(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
