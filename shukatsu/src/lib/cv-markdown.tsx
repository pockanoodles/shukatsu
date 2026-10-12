/**
 * Render the CV markdown the engine writes (core/render.mjs) as plain,
 * ATS-safe HTML: one column, real headings, real list items, no tables.
 * Only that format is supported: # name, **Label:** lines, ## section,
 * ### heading, **title** line, dates line, - bullets.
 */

const strong = (s: string) => {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
};

export function CvDocument({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const head: string[] = [];
  let name = "";
  const sections: { title: string; blocks: { heading?: string; meta: string[]; bullets: string[]; text: string[] }[] }[] = [];
  let sec: (typeof sections)[number] | null = null;
  let block: (typeof sections)[number]["blocks"][number] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) { name = line.slice(2).replace(/^CV\s*--\s*/, ""); continue; }
    if (line.startsWith("## ")) { sec = { title: line.slice(3), blocks: [] }; sections.push(sec); block = null; continue; }
    if (!sec) { head.push(line); continue; }
    if (line.startsWith("### ")) { block = { heading: line.slice(4), meta: [], bullets: [], text: [] }; sec.blocks.push(block); continue; }
    if (!block) { block = { meta: [], bullets: [], text: [] }; sec.blocks.push(block); }
    if (/^[-*]\s/.test(line)) block.bullets.push(line.replace(/^[-*]\s+/, ""));
    else if (block.heading && !block.bullets.length) block.meta.push(line);
    else block.text.push(line);
  }
  return (
    <article className="cv">
      <header>
        {/* A 職務経歴書 is titled as one, with the name under it. */}
        {name.startsWith("職務経歴書") ? <><h1 lang="ja">職務経歴書</h1><p className="name" lang="ja">{name.replace(/^職務経歴書\s*--\s*/, "")}</p></> : <h1>{name}</h1>}
        <p className="contact">{head.map((h) => h.replace(/^\*\*[^*]+:\*\*\s*/, "")).join("  ·  ")}</p>
      </header>
      {sections.map((s) => (
        <section key={s.title}>
          <h2>{s.title}</h2>
          {s.blocks.map((b, i) => (
            <div key={i} className="block">
              {b.heading && <h3>{b.heading.replace(/\s--\s/, " | ")}</h3>}
              {b.meta.length > 0 && <p className="meta">{b.meta.map((m, j) => <span key={j}>{strong(m)}{j < b.meta.length - 1 ? " · " : ""}</span>)}</p>}
              {b.text.map((tx, j) => <p key={j}>{strong(tx)}</p>)}
              {b.bullets.length > 0 && <ul>{b.bullets.map((x, j) => <li key={j}>{strong(x)}</li>)}</ul>}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
