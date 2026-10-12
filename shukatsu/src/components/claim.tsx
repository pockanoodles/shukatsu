/**
 * A claim with its figures set like stamped numbers, so a reviewer's eye lands
 * on exactly what they're vouching for. `changed` marks figures that differ
 * from the version being compared against.
 */
// A digit glued to a letter ("3D-printed", "1e-12") isn't a figure unless the letter is a unit.
const FIGURE = /[~$¥]{0,2}(?<![A-Za-z])\d+(?:,\d{3})*(?:\.\d+)?(?:\s?[kKmMbB](?![a-zA-Z])|[千万億])?(?:%|×|x(?![a-zA-Z]))?(?![A-Za-z])/gu;

const core = (s: string) => s.replace(/[~$¥%×x,\s]/g, "");

export function Claim({ text, changed = [], className = "" }: { text: string; changed?: string[]; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(FIGURE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const hit = changed.some((c) => core(m[0]).replace(/^0+(?=\d)/, "") === c || core(m[0]) === c);
    parts.push(<span key={i++} className={`fig${hit ? " changed" : ""}`}>{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}

/** How many figures a reviewer is being asked about. */
export const figureCount = (text: string) => [...text.matchAll(FIGURE)].length;
