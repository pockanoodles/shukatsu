/**
 * Surgical YAML edits: change a value, add a key, or append a list item by
 * splicing the original text at the parser's source offsets.
 *
 * A full re-stringify (even comment-preserving) rewrites every flow collection
 * and realigns every column, so one approval would read as a hundred-line diff
 * in the data root's history. Splicing touches only the bytes that changed:
 * comments, alignment, and quoting everywhere else survive untouched. Each edit
 * re-parses before and after, so a splice that breaks the document throws
 * instead of being written.
 */

import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const RESERVED = /^(true|false|null|yes|no|on|off|y|n|~)$/i;

/** A scalar the way this file writes them: plain when unambiguous, else double-quoted. */
export function scalarText(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v == null) return 'null';
  const s = String(v);
  if (/^[A-Za-z][A-Za-z0-9._/-]*$/.test(s) && !RESERVED.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return JSON.stringify(s);
}

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const allScalar = (v) => (Array.isArray(v) ? v : Object.values(v)).every((x) => !isPlainObject(x) && !Array.isArray(x));

/** Inline form for short collections: `[a, b]` and `{ k: v }`, as the file already writes them. */
export function flowText(v) {
  if (Array.isArray(v)) return `[${v.map(scalarText).join(', ')}]`;
  return `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${scalarText(x)}`).join(', ')} }`;
}

/** Block lines for a mapping, at `indent` spaces. Nested lists of mappings stay block. */
export function blockLines(obj, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.some(isPlainObject)) {
      out.push(`${pad}${k}:`);
      for (const item of v) {
        const lines = blockLines(item, indent + 4);
        out.push(`${pad}  - ${lines[0].trimStart()}`, ...lines.slice(1).map((l) => l.slice(2)));
      }
    } else if (isPlainObject(v) && !allScalar(v)) {
      out.push(`${pad}${k}:`, ...blockLines(v, indent + 2));
    } else if (Array.isArray(v) || isPlainObject(v)) {
      out.push(`${pad}${k}: ${flowText(v)}`);
    } else out.push(`${pad}${k}: ${scalarText(v)}`);
  }
  return out;
}

const column = (text, offset) => offset - text.lastIndexOf('\n', offset - 1) - 1;

/**
 * Where a node's content really ends. A block collection's source range runs
 * through the next line's indentation, and can swallow comment lines that
 * belong to whatever follows, so back up over both.
 */
function contentEnd(text, start, end) {
  let e = end;
  for (;;) {
    while (e > start && /\s/.test(text[e - 1])) e--;
    const lineStart = text.lastIndexOf('\n', e - 1) + 1;
    if (lineStart > start && text.slice(lineStart, e).trimStart().startsWith('#')) e = lineStart;
    else return e;
  }
}

function parse(text) {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`YAML parse error: ${doc.errors[0].message}`);
  return doc;
}

function nodeAt(doc, path, want) {
  const node = path.length ? doc.getIn(path, true) : doc.contents;
  if (!node || (want === 'map' && !isMap(node)) || (want === 'seq' && !isSeq(node))) {
    throw new Error(`No ${want} at ${path.join('.')}`);
  }
  return node;
}

function checked(before, after) {
  parse(after);
  return after === before ? before : after;
}

/**
 * Set `key` on the mapping at `path` to `value`. Replaces the value in place
 * when the key exists; appends a line (block map) or an entry (flow map) when
 * it doesn't. `value` may be a scalar, a scalar list, or a flat mapping.
 */
export function setKey(text, path, key, value) {
  const doc = parse(text);
  const map = nodeAt(doc, path, 'map');
  const rendered = Array.isArray(value) || isPlainObject(value) ? flowText(value) : scalarText(value);
  const pair = map.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === key);
  if (pair && pair.value) {
    const [start, end] = pair.value.range;
    return checked(text, text.slice(0, start) + rendered + text.slice(end));
  }
  if (map.flow) {
    const close = text.lastIndexOf('}', map.range[1]);
    const before = text.slice(0, close).replace(/\s*$/, '');
    const sep = map.items.length ? ', ' : ' ';
    return checked(text, `${before}${sep}${key}: ${rendered} ${text.slice(close)}`);
  }
  if (!map.items.length) throw new Error(`Empty block map at ${path.join('.')}`);
  const last = map.items.at(-1);
  const end = contentEnd(text, map.range[0], (last.value || last.key).range[1]);
  const indent = column(text, map.items[0].key.range[0]);
  return checked(text, `${text.slice(0, end)}\n${' '.repeat(indent)}${key}: ${rendered}${text.slice(end)}`);
}

/** Remove `key` from the block mapping at `path` (its whole line). No-op when absent. */
export function deleteKey(text, path, key) {
  const doc = parse(text);
  const map = nodeAt(doc, path, 'map');
  const pair = map.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === key);
  if (!pair) return text;
  if (map.flow) {
    // Take the separator with it: the comma before it, or after it when it's first.
    let start = pair.key.range[0];
    let end = (pair.value || pair.key).range[1];
    const before = text.slice(0, start).match(/,\s*$/);
    if (before) start -= before[0].length;
    else {
      const after = text.slice(end).match(/^\s*,\s*/);
      if (after) end += after[0].length;
    }
    return checked(text, text.slice(0, start) + text.slice(end));
  }
  const start = text.lastIndexOf('\n', pair.key.range[0]);
  const end = contentEnd(text, pair.key.range[0], (pair.value || pair.key).range[1]);
  return checked(text, text.slice(0, start) + text.slice(end));
}

/** Append a mapping to the block (or empty flow) sequence at `path`. */
export function appendItem(text, path, obj) {
  const doc = parse(text);
  const seq = nodeAt(doc, path, 'seq');
  if (seq.flow) {
    if (seq.items.length) throw new Error(`Flow sequence at ${path.join('.')} is not empty`);
    // `facts: []` -> a block list one level under its key.
    const lineStart = text.lastIndexOf('\n', seq.range[0]) + 1;
    const keyIndent = text.slice(lineStart).match(/^ */)[0].length;
    const lines = blockLines(obj, keyIndent + 4);
    const block = [`${' '.repeat(keyIndent + 2)}- ${lines[0].trimStart()}`, ...lines.slice(1)].join('\n');
    const keyEnd = text.lastIndexOf(':', seq.range[0]) + 1;
    return checked(text, `${text.slice(0, keyEnd)}\n${block}${text.slice(seq.range[1])}`);
  }
  if (!seq.items.length) throw new Error(`Empty block sequence at ${path.join('.')}`);
  const dash = column(text, seq.items[0].range[0]) - 2;
  const lines = blockLines(obj, dash + 2);
  const block = [`${' '.repeat(dash)}- ${lines[0].trimStart()}`, ...lines.slice(1)].join('\n');
  const end = contentEnd(text, seq.range[0], seq.items.at(-1).range[1]);
  return checked(text, `${text.slice(0, end)}\n${block}${text.slice(end)}`);
}
