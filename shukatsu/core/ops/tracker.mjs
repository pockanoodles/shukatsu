/**
 * The application tracker, read through upstream's parser and written only
 * through upstream's CLIs (set-status.mjs, merge-tracker.mjs), so the states
 * contract, the lock, and data/status-log.tsv stay theirs. An agent's status
 * change is logged with source `set-status` like any other; app.db's
 * activity log is what records which agent made it. Applied and Hired record
 * the candidate's own act (they sent it, they took the job), so moving a row
 * there is a stamp, the same as packet.markSent: an agent never does it.
 */

import { spawnSync } from 'child_process';
import { join } from 'path';
import { addTrackerRow, canonicalStates, readTracker, setStatus, setTargetDue, statusLog, targetDueCells } from '../tracker.mjs';
import { ENGINE } from '../trace.mjs';
import { S } from './schema.mjs';

const STATES = canonicalStates().map((s) => s.label);

/** The permission a move to this state needs: a stamp for the candidate's own act, tracker.write for the rest. */
const OWN_ACT = new Set(['Applied', 'Hired']);
const toState = (state) => (OWN_ACT.has(state) ? 'tracker.decide' : 'tracker.write');

// Target and Due: blank leaves the cell as it is, — clears it.
const TARGET = S.str('An outcome key from data/targets.yml (e.g. summer-27), or — to clear.', { maxLength: 40, default: '' });
const DUE = S.str('The deadline, YYYY-MM-DD, optionally followed by a short note; — to clear.', { maxLength: 80, default: '' });

const ROW = S.obj({
  num: S.int(), date: S.nullable(S.str()), company: S.str(), role: S.str(), score: S.nullable(S.str()), status: S.str(),
  pdf: S.any(), report: S.any(), notes: S.any(), url: S.any(), via: S.any(), location: S.any(), history: S.arr(S.any()),
});

const rowView = (r, history) => ({
  num: r.num, date: r.date ?? null, company: r.company, role: r.role, score: r.score ?? null, status: r.status,
  pdf: r.pdf ?? null, report: r.report ?? null, notes: r.notes ?? null, url: r.url ?? null, via: r.via ?? null, location: r.location ?? null,
  history: history || [],
});

export default [
  {
    name: 'tracker.list',
    kind: 'query',
    summary: 'The application tracker (data/applications.md), each row with its status history. The canonical states are Evaluated, Applied, Responded, Interview, Offer, Hired, Rejected, Discarded, SKIP.',
    permission: 'view',
    input: S.obj({
      status: S.enum(STATES, 'Only rows in this state.'),
      q: S.str('Only rows whose company or role contains this.', { maxLength: 100 }),
    }),
    output: S.obj({ states: S.arr(S.str()), rows: S.arr(ROW) }, ['rows']),
    run: ({ root, input }) => {
      const log = statusLog(root);
      const q = input.q?.toLowerCase();
      const rows = readTracker(root).rows
        .filter((r) => !input.status || r.status === input.status)
        .filter((r) => !q || `${r.company} ${r.role}`.toLowerCase().includes(q))
        .map((r) => rowView(r, log.get(String(r.num))));
      return { states: STATES, rows };
    },
  },
  {
    name: 'company.history',
    kind: 'query',
    summary: 'Everything known about one company across the tracker, follow-ups, scans, and the status log: past applications, responsiveness, reposts.',
    permission: 'view',
    input: S.obj({ company: S.str(null, { minLength: 1, maxLength: 100 }) }, ['company']),
    output: S.any(),
    run: ({ root, input }) => {
      const r = spawnSync(process.execPath, [join(ENGINE, 'company-history.mjs'), '--company', input.company], {
        cwd: ENGINE, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_DATA_DIR: root }, timeout: 30_000,
      });
      try { return JSON.parse(r.stdout); } catch { throw new Error(`company-history failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`); }
    },
  },
  {
    name: 'tracker.setStatus',
    kind: 'command',
    summary: 'Move an application to a new canonical state, through set-status.mjs (validated, locked, logged to the status log). Applied and Hired record the candidate\'s own act, so they are stamps: an agent leaves those to the candidate.',
    permission: (input) => toState(input.state),
    input: S.obj({
      num: S.tracker(),
      state: S.enum(STATES),
      note: S.str('Why, for the tracker notes and the status log.', { maxLength: 300, default: '' }),
    }, ['num', 'state']),
    output: S.obj({ num: S.int(), state: S.str() }, ['num', 'state']),
    activity: (input) => ({ verb: 'tracker.status', subject: `app:${input.num}`, detail: { to: input.state } }),
    run: ({ root, input }) => {
      const r = setStatus(root, input.num, input.state, input.note);
      if (!r.ok) throw new Error(r.out.split('\n').filter(Boolean).slice(-2).join(' ') || 'set-status.mjs refused the change.');
      return { num: input.num, state: input.state };
    },
  },
  {
    name: 'tracker.add',
    kind: 'command',
    summary: 'Add an application to the tracker without an evaluation (e.g. one applied to through a career fair site). The row goes in through merge-tracker.mjs, which updates an existing company+role row instead of duplicating it. Adding it as Applied or Hired is a stamp, so an agent adds it as Evaluated and leaves the rest to the candidate.',
    permission: (input) => toState(input.status),
    input: S.obj({
      company: S.str(null, { minLength: 1, maxLength: 80 }),
      role: S.str(null, { minLength: 1, maxLength: 160 }),
      status: S.enum(STATES, null, { default: 'Evaluated' }),
      url: S.str(null, { maxLength: 2000, default: '' }),
      notes: S.str(null, { maxLength: 300, default: '' }),
      target: TARGET,
      due: DUE,
    }, ['company', 'role']),
    output: S.obj({ num: S.int() }, ['num']),
    activity: (input, out) => ({ verb: 'tracker.added', subject: `app:${out.num}`, detail: { company: input.company, role: input.role } }),
    run: async ({ root, input }) => {
      const { target, due, ...row } = input;
      const cells = target || due ? { target: target || undefined, due: due || undefined } : null;
      // Checked before the row goes in (values and columns), so a refusal never leaves a row behind.
      if (cells) targetDueCells(root, cells);
      const r = addTrackerRow(root, { ...row, score: 'N/A' });
      if (!r.ok) throw new Error(r.out);
      if (cells) await setTargetDue(root, r.num, cells);
      return { num: r.num };
    },
  },
  {
    name: 'tracker.setTargetDue',
    kind: 'command',
    summary: 'Set an application\'s Target (which outcome in data/targets.yml it is for) and/or its Due date (the deadline). These are this tracker\'s own columns: merge-tracker.mjs leaves them as — on a new row, so fill them here once the row exists. — clears one. From the app and the terminal (shukatsu/target.mjs); an agent sets both when it adds the row.',
    permission: 'tracker.write',
    agent: false,
    input: S.obj({
      num: S.tracker(),
      target: TARGET,
      due: DUE,
    }, ['num']),
    output: S.obj({ num: S.int(), target: S.nullable(S.str()), due: S.nullable(S.str()), changed: S.bool() }, ['num', 'target', 'due', 'changed']),
    activity: (input) => ({ verb: 'tracker.target', subject: `app:${input.num}`, detail: { target: input.target || null, due: input.due || null } }),
    run: ({ root, input }) => setTargetDue(root, input.num, { target: input.target || undefined, due: input.due || undefined }),
  },
];
