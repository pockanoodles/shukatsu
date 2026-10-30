/**
 * `--help` for the fork's CLIs: print the script's own header comment.
 *
 * Every CLI here already documents its commands in the comment at the top of
 * the file, so that comment is the help text, and the two can never disagree.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/** The first `/** ... *\/` block of a source file, without the comment marks. */
export function headerText(src) {
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return '';
  return m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
}

/** Print the header of the module at `url` (pass `import.meta.url`). */
export function printUsage(url) {
  process.stdout.write(`${headerText(readFileSync(fileURLToPath(url), 'utf-8'))}\n`);
}
