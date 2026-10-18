import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptInvite, can, createInvite, createSession, disableUser, endSession, hasOwner, peekInvite, sessionUser, signIn, updateUser,
} from '../core/people.mjs';
import { db } from '../core/store.mjs';
import { makeRoot, people } from './helpers.mjs';

test('there is no way in until the CLI creates the owner invite', () => {
  const root = makeRoot();
  assert.equal(hasOwner(root), false);
  assert.throws(() => createInvite(root, { actor: null, role: 'editor', name: 'Stranger' }), /Only the owner/);
  const t = createInvite(root, { actor: null, role: 'owner', name: 'Owner' });
  acceptInvite(root, t, { login: 'owner', password: 'a long password here' });
  assert.throws(() => createInvite(root, { actor: null, role: 'owner', name: 'Second' }), /Only the owner/);
});

test('an invite works once and only with a decent password', () => {
  const root = makeRoot();
  const { owner } = people(root);
  const t = createInvite(root, { actor: owner, role: 'viewer', name: 'Dad' });
  assert.ok(peekInvite(root, t));
  assert.throws(() => acceptInvite(root, t, { login: 'dad', password: 'short' }), /password\.short/);
  assert.throws(() => acceptInvite(root, t, { login: 'dad', password: 'dad-is-my-password' }), /password\.login/);
  acceptInvite(root, t, { login: 'dad', password: 'a perfectly fine secret' });
  assert.equal(peekInvite(root, t), null);
  assert.throws(() => acceptInvite(root, t, { login: 'dad2', password: 'a perfectly fine secret' }), /invite\.invalid/);
});

test('sign-in checks the password and throttles guessing', () => {
  const root = makeRoot();
  people(root);
  assert.equal(signIn(root, { login: 'MOM', password: 'another long secret', ip: '1.1.1.1' }).name, 'Mom');
  for (let i = 0; i < 8; i++) assert.throws(() => signIn(root, { login: 'mom', password: 'wrong guess', ip: '2.2.2.2' }), /signin\.failed/);
  assert.throws(() => signIn(root, { login: 'mom', password: 'another long secret', ip: '3.3.3.3' }), /signin\.throttled/);
});

test('a session resolves to its user until it ends or the user is disabled, and disabling takes their passkeys too', () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const s = createSession(root, editor);
  assert.equal(sessionUser(root, s.token).id, editor.id);
  endSession(root, s.token);
  assert.equal(sessionUser(root, s.token), null);
  const s2 = createSession(root, editor);
  db(root).prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, created_at) VALUES ('k1', ?, x'00', 0, '2026-10-18T00:00:00Z')`).run(editor.id);
  disableUser(root, { actor: owner, id: editor.id });
  assert.equal(sessionUser(root, s2.token), null);
  assert.equal(db(root).prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(editor.id).n, 0);
});

test('permissions follow the role, and compensation is granted per person', () => {
  const root = makeRoot();
  const { owner, editor, reviewer } = people(root);
  assert.ok(can(owner, 'review.decide'));
  assert.ok(!can(editor, 'review.decide') && can(editor, 'packet.create') && can(editor, 'propose.profile'));
  assert.ok(!can(reviewer, 'propose.profile') && can(reviewer, 'comment') && can(reviewer, 'suggest.posting'));
  assert.ok(!can(editor, 'view.comp'));
  const granted = updateUser(root, { actor: owner, id: editor.id, changes: { can_see_comp: true } });
  assert.ok(can(granted, 'view.comp'));
  assert.ok(!can(editor, 'view.contacts'));
  assert.throws(() => updateUser(root, { actor: editor, id: reviewer.id, changes: { role: 'editor' } }), /permission/);
  assert.throws(() => updateUser(root, { actor: owner, id: editor.id, changes: { role: 'owner' } }), /one owner/);
});

test('a reset link sets a new password and signs the person out everywhere', () => {
  const root = makeRoot();
  const { owner, editor } = people(root);
  const s = createSession(root, editor);
  const t = createInvite(root, { actor: owner, role: editor.role, name: editor.name, userId: editor.id });
  acceptInvite(root, t, { password: 'brand new secret phrase' });
  assert.equal(sessionUser(root, s.token), null);
  assert.equal(signIn(root, { login: 'mom', password: 'brand new secret phrase', ip: '9.9.9.9' }).id, editor.id);
});
