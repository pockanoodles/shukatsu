import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

/**
 * The one-door rule, checked: no server action, page, route, or CLI changes
 * the record, the tracker, or app.db except through ops.run. Sign-in itself
 * is the one exception, because it creates the principal ops.run needs.
 */

const APP = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Engine functions that write. Calling one of these from outside core/ is going around the registry.
const WRITERS = [
  'decide', 'reopen', 'propose', 'withdraw', 'revise', 'addComment', 'resolveComment', 'setStatus', 'addTrackerRow', 'appendPipeline',
  'createPacket', 'setBullet', 'changeSelection', 'checkPacket', 'setCover', 'setAnswers', 'requestReview', 'withdrawReview', 'markReady',
  'markSent', 'closePacket', 'setCandidateJa', 'updateUser', 'disableUser', 'enableUser', 'revokeInvite', 'setPassword', 'removePasskey',
  'endSessionByHash', 'logActivity', 'issueToken', 'revokeToken', 'createAgent', 'disableAgent', 'createEvent', 'updateEvent', 'cancelEvent',
  'markDone', 'createCampaign', 'updateCampaign', 'linkRows', 'submitEvaluation', 'capture', 'editProfile', 'suggestRewordings',
];
const CALL = new RegExp(`\\.(${WRITERS.join('|')})\\(`);
const SQL_WRITE = /\.prepare\(\s*[`'"]\s*(INSERT|UPDATE|DELETE)/i;

// Sign-in: sessions, invites accepted, passkey ceremonies, login attempts.
const SIGN_IN = { 'src/app/actions/auth.ts': ['signIn', 'acceptInvite', 'createSession', 'endSession', 'finishRegistration', 'finishAuthentication'] };

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('nothing in the app writes around the operations registry', () => {
  const offenders = [];
  for (const file of files(join(APP, 'src'))) {
    const rel = relative(APP, file);
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      const m = line.match(CALL);
      if (m && !(SIGN_IN[rel] || []).includes(m[1])) offenders.push(`${rel}:${i + 1} calls ${m[1]}()`);
      if (SQL_WRITE.test(line)) offenders.push(`${rel}:${i + 1} writes SQL directly`);
    });
  }
  assert.deepEqual(offenders, [], `Route these through ops.run:\n${offenders.join('\n')}`);
});

test('the writing CLIs go through the registry too', () => {
  for (const cli of ['review.mjs', 'people.mjs']) {
    const text = readFileSync(join(APP, cli), 'utf-8');
    assert.match(text, /callOp\(/, `${cli} should call operations through core/client.mjs`);
    const direct = text.split('\n').filter((l) => CALL.test(l) && !/createInvite\(root, \{ actor: null, role: 'owner'/.test(l));
    assert.deepEqual(direct, [], `${cli} writes directly:\n${direct.join('\n')}`);
  }
});

test('the daemon\'s HTTP routes reach the engine only through ops', () => {
  for (const mod of ['core/api.mjs', 'core/cal.mjs']) {
    const text = readFileSync(join(APP, mod), 'utf-8');
    assert.doesNotMatch(text, CALL, `${mod} calls an engine writer`);
    assert.doesNotMatch(text, SQL_WRITE, `${mod} writes SQL directly`);
  }
});
