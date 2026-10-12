/**
 * The candidate's Japanese contact block (`candidate.ja` in the master profile):
 * the name, location, and availability a 職務経歴書 prints in place of the
 * English ones. Japanese employers need 2027年1月〜6月, not "co-op".
 *
 * Only the candidate sets it, and it goes through the same write path as every
 * other profile change, so it is validated and committed. Nothing is guessed:
 * a field left empty falls back to the English one.
 */

import { loadProfile } from './facts.mjs';
import { editProfile } from './profile-edit.mjs';
import { assertCan } from './people.mjs';
import { logActivity } from './store.mjs';

export const JA_FIELDS = ['name', 'location', 'availability'];

export function candidateJa(root) {
  const c = loadProfile(root).candidate || {};
  return { en: { name: c.name || '', location: c.location || '', availability: c.availability || '' }, ja: c.ja || {} };
}

/** Which Japanese header fields a 職務経歴書 still prints in English. */
export function jaHeaderGaps(root) {
  const { ja } = candidateJa(root);
  return JA_FIELDS.filter((k) => k !== 'location' && !ja[k]);
}

export function setCandidateJa(root, { actor, values }) {
  assertCan(actor, 'profile.write');
  const clean = Object.fromEntries(JA_FIELDS.map((k) => [k, String(values?.[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)]).filter(([, v]) => v));
  const r = editProfile(root, {
    actor, message: 'Set the Japanese contact block',
    apply: (tx) => {
      if (Object.keys(clean).length) tx.set(['candidate'], 'ja', clean);
      else tx.unset(['candidate'], 'ja');
    },
  });
  logActivity(root, { actor, verb: 'profile.candidate-ja', subject: 'profile:candidate', detail: { fields: Object.keys(clean) } });
  return r;
}
