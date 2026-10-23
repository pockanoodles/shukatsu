import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const { NETWORK_CALL } = await import('../core/upstream.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const REPO = join(APP, '..');
const DOC = readFileSync(join(REPO, 'DATAFLOW.md'), 'utf-8');

/**
 * The modules that call an outside service. Each writes the egress log, and
 * DATAFLOW.md names it and says what it sends. A module that starts calling
 * out belongs here, with its row in DATAFLOW.md.
 */
const CALLS_OUT = {
  'core/llm.mjs': 'the model',
  'connectors/ctx.mjs': 'every connector request',
  'core/oauth.mjs': "an MCP client's public description",
};

/** Calls that look like egress but stay on the machine, or go out through a module above. */
const STAYS_HOME = {
  'core/client.mjs': "the CLIs, to this machine's own daemon",
  'mcp-stdio.mjs': "the stdio bridge, to this machine's own daemon",
  'extension/background.js': "the extension, to the candidate's own shukatsu",
  'extension/options.js': "the extension's options page, to the candidate's own shukatsu",
  'connectors/gmail/oauth.mjs': 'Google sign-in, through the guarded fetch connectors/ctx.mjs hands it',
  'connectors/line/index.mjs': "LINE's requests, through the ctx.fetch connectors/ctx.mjs hands it",
};

/** The app's source files, tracked or about to be: what this public repo carries. Tests are left out. */
function sources() {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: APP, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split('\0'))].filter((f) => /\.(mjs|cjs|js|ts|tsx)$/.test(f) && !f.startsWith('tests/'));
}

const callsOut = (text) => text.split('\n').some((line) => {
  const t = line.trim();
  return !t.startsWith('//') && !t.startsWith('*') && NETWORK_CALL.test(t);
});

test('every module that calls out is one DATAFLOW.md names, and each writes the egress log', () => {
  const found = sources().filter((f) => callsOut(readFileSync(join(APP, f), 'utf-8')));
  const unknown = found.filter((f) => !(f in CALLS_OUT) && !(f in STAYS_HOME));
  assert.deepEqual(unknown, [], 'a module calls out without a DATAFLOW.md row: add it to CALLS_OUT (and the doc) or STAYS_HOME (with why)');
  for (const f of Object.keys(STAYS_HOME)) assert.ok(found.includes(f), `${f} no longer calls out: take it off STAYS_HOME`);
  for (const f of Object.keys(CALLS_OUT)) {
    assert.ok(found.includes(f), `${f} no longer calls out: take it off CALLS_OUT`);
    assert.ok(DOC.includes(`shukatsu/${f}`), `DATAFLOW.md names shukatsu/${f} (${CALLS_OUT[f]})`);
    assert.match(readFileSync(join(APP, f), 'utf-8'), /\blogEgress\(/, `${f} writes the egress log`);
  }
  assert.ok(DOC.includes('shukatsu/core/egress.mjs'), 'DATAFLOW.md names the egress log module');
});

test('DATAFLOW.md has a section for every connector, naming every host it may reach', () => {
  const dir = join(APP, 'connectors');
  const manifests = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => JSON.parse(readFileSync(join(dir, e.name, 'manifest.json'), 'utf-8')));
  assert.ok(manifests.length >= 4);
  for (const m of manifests) {
    assert.ok(DOC.includes(`### ${m.name} (\`${m.id}\`)`), `DATAFLOW.md has a "${m.name} (\`${m.id}\`)" section`);
    for (const host of m.allowedHosts || []) assert.ok(DOC.includes(`\`${host}\``), `DATAFLOW.md names ${host}, which ${m.id} may reach`);
  }
});

test('the app keeps one DATAFLOW.md, at the repo root', () => {
  assert.throws(() => readFileSync(join(APP, 'DATAFLOW.md')), /ENOENT/, 'a second copy drifts from the first');
});
