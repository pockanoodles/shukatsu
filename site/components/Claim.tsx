// A claim with its figures set like stamped numbers. The pattern is the app's
// (../shukatsu/src/components/claim.tsx), so the page marks exactly the
// figures the app would ask a reviewer about. Keep the two in step.
// `changed` marks figures that differ from the version before.
const FIGURE = /[~$¥]{0,2}(?<![A-Za-z])\d+(?:,\d{3})*(?:\.\d+)?(?:\s?[kKmMbB](?![a-zA-Z])|[千万億])?(?:%|×|x(?![a-zA-Z]))?(?![A-Za-z])/gu;

export function Claim({ text, changed = [], gone = [], className = "" }: { text: string; changed?: string[]; gone?: string[]; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(FIGURE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const state = changed.includes(m[0]) ? " changed" : gone.includes(m[0]) ? " gone" : "";
    parts.push(<span key={i++} className={`fig${state}`}>{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className}>{parts}</span>;
}

/** How many figures a reviewer is being asked about. */
export const figureCount = (text: string) => [...text.matchAll(FIGURE)].length;
