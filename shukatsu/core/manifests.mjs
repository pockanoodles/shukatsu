/**
 * Manifests: one JSON per tailored resume, listing the fact IDs it carries.
 * They are what makes a retired claim recallable: `used <fact-id>` lists every
 * application that received it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { isActive } from './facts.mjs';

export const manifestDir = (root) => join(root, 'data', 'manifests');

export function readManifests(root) {
  const dir = manifestDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: join(dir, f), name: basename(f, '.json'), ...JSON.parse(readFileSync(join(dir, f), 'utf-8')) }));
}

export function readManifest(root, name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('bad manifest name');
  const file = join(manifestDir(root), `${name}.json`);
  if (!existsSync(file)) return null;
  return { file, name, ...JSON.parse(readFileSync(file, 'utf-8')) };
}

export function writeManifest(root, name, m) {
  mkdirSync(manifestDir(root), { recursive: true });
  const { file: _f, name: _n, ...rest } = m;
  writeFileSync(join(manifestDir(root), `${name}.json`), `${JSON.stringify(rest, null, 2)}\n`);
}

/** Fact IDs a manifest sent (the traced final when there is one, else the selection). */
export const sentIds = (m) => (m.final?.length ? m.final.map((x) => x.id) : (m.selection || []).flatMap((s) => s.facts.map((f) => f.id)));

/** Every manifest that carried `want(id)`, newest first. */
export function usage(root, p, want) {
  const out = [];
  for (const m of readManifests(root)) {
    const hit = [...new Set(sentIds(m).filter(want))];
    if (hit.length) out.push({ manifest: m, ids: hit });
  }
  return out.reverse();
}

export const usedRetired = (root, p) => usage(root, p, (id) => p._facts.has(id) && !isActive(p._facts.get(id).fact));
