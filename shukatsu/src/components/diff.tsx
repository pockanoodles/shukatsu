/**
 * Word-level diff between two wordings: what a proposal removes is struck, what
 * it adds is underlined in shu. Small inputs (one bullet), so a plain LCS table
 * is fine.
 */
function tokens(s: string) {
  return s.match(/\s+|[^\s]+/g) || [];
}

export function Diff({ before, after }: { before: string; after: string }) {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: string; k: "same" | "del" | "add" }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: a[i], k: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], k: "del" });
    else out.push({ t: b[j++], k: "add" });
  }
  while (i < n) out.push({ t: a[i++], k: "del" });
  while (j < m) out.push({ t: b[j++], k: "add" });
  // Merge runs, so "built automations deriving" reads as one struck phrase with
  // its spaces, followed by the phrase that replaced it.
  const runs: { t: string; k: "same" | "del" | "add" }[] = [];
  for (const p of out) {
    const last = runs.at(-1);
    if (last && last.k === p.k) last.t += p.t;
    else runs.push({ ...p });
  }
  return (
    <span>
      {runs.map((p, idx) => {
        if (p.k === "same") return <span key={idx}>{p.t}</span>;
        const text = p.t.trim();
        if (!text) return p.k === "add" ? <span key={idx}>{p.t}</span> : null;
        const space = p.k === "del" && runs[idx + 1]?.k === "add" ? " " : "";
        return p.k === "del"
          ? <span key={idx}><del className="text-ink-3 decoration-ink-3">{text}</del>{space}</span>
          : <ins key={idx} className="no-underline [text-decoration:underline_2px_var(--shu)] [text-underline-offset:4px]">{text}</ins>;
      })}
    </span>
  );
}
