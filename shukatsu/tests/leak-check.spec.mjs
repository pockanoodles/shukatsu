import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const { allowed, matcher, termsFrom } = await import('../leak-check.mjs');
const { makeRoot } = await import('./helpers.mjs');

function root() {
  const r = makeRoot();
  mkdirSync(join(r, 'config'), { recursive: true });
  writeFileSync(join(r, 'config', 'profile.yml'), 'candidate:\n  full_name: Test Candidate\n  email: test@example.com\n  phone: "+1 617 555 0142"\n  linkedin: https://www.linkedin.com/in/test-candidate-0a1b2c\n');
  writeFileSync(join(r, 'data', 'targets.yml'), 'companies:\n  - { name: Globex Securities, tier: A }\n  - { name: Initech, tier: B }\n');
  writeFileSync(join(r, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Status |\n|---|---|---|---|---|\n| 1 | 2026-10-14 | Umbrella Corp | Analyst | Applied |\n');
  return r;
}

test('the words to keep out come from the data root: name, contact details, record, tracker, targets', () => {
  const terms = termsFrom(root());
  for (const w of ['Test Candidate', 'Candidate', 'test@example.com', '5550142', 'linkedin.com/in/test-candidate-0a1b2c', 'Globex Securities', 'Globex', 'Initech', 'Umbrella Corp', 'Umbrella']) {
    assert.ok(terms.has(w), `${w} is a word to keep out`);
  }
  assert.ok(![...terms.keys()].some((w) => w.length < 4), 'short words are too common to check');
});

test('a word matches whole and in its own case, and an allowed phrase is let through only where it is allowed', () => {
  const r = root();
  const find = matcher(termsFrom(r));
  assert.deepEqual(find('Reached out to Initech about the role.'), ['Initech']);
  assert.deepEqual(find('Initechnology is a different word.'), []);
  assert.deepEqual(find('the umbrella corp of it'), ['Umbrella Corp'], 'a name with a space matches in any case');
  writeFileSync(join(r, 'config', 'leak-check.yml'), 'allow:\n  - { phrase: "Test Candidate", in: [site/] }\n');
  const allow = allowed(r);
  assert.deepEqual(find(allow('site/copy.ts', 'Made by Test Candidate.')), []);
  assert.ok(find(allow('shukatsu/people.mjs', 'init --name "Test Candidate"')).includes('Test Candidate'), 'allowed in site/ only');
});
