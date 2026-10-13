import type { T } from "@/lib/i18n";

/** The hanko. Shu means "needs your stamp"; ink means done. */
export function Stamp({ children, size = "", tone = "shu", press = false, two = false, label }: { children: React.ReactNode; size?: "" | "sm" | "lg"; tone?: "shu" | "ink" | "dashed" | "on"; press?: boolean; two?: boolean; label?: string }) {
  return (
    <span className={`stamp ${size} ${tone === "shu" ? "" : tone} ${press ? "press" : ""} ${two ? "two" : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
    </span>
  );
}

/** The seal in a pill's left cap: one kanji for the decision the button records. */
export function Seal({ k }: { k: string }) {
  return <span className="seal" aria-hidden>{k}</span>;
}

/** Provenance letter: what backs a fact. */
export function Prov({ letter, t }: { letter: string | null; t: T }) {
  if (!letter) return null;
  return <span className="prov" title={t(`prov.${letter}`)} aria-label={t("review.backedBy", { what: t(`prov.${letter}`) })}>{letter}</span>;
}

export function StatusMark({ status, review, t }: { status: string; review: string; t: T }) {
  const key = status !== "active" ? status : review === "verified" ? "confirmed" : "waiting";
  const tone = key === "waiting" ? "text-shu" : key === "confirmed" ? "text-ink" : "text-ink-3";
  return <span className={`label ${tone}`}>{t(`status.${key}`)}</span>;
}

/** Section opener: mono eyebrow, display title, one plain sentence. */
export function Head({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b-2 rule px-4 pb-5 pt-8 sm:px-10">
      <div className="max-w-3xl">
        {eyebrow && <p className="label text-ink-2">{eyebrow}</p>}
        <h1 className="display mt-2 text-[40px] sm:text-[56px]">{title}</h1>
        {lead && <p className="mt-4 max-w-2xl text-[16px] text-ink-2">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

/** A flash line after an action, from `?done=` or an action result. */
export function Flash({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "shu" }) {
  return (
    <div role="status" className={`fade flex items-center gap-3 border-b-2 rule px-4 py-3 sm:px-10 ${tone === "shu" ? "bg-shu text-on-shu" : "bg-ink text-on-ink"}`}>
      <span className="label">{children}</span>
    </div>
  );
}

export function Findings({ findings, t }: { findings: { severity: string; rule: string; message: string }[]; t: T }) {
  if (!findings.length) return <span className="text-[14.5px] text-ink-2">{t("review.rules.pass")}</span>;
  return (
    <ul className="grid gap-1.5">
      {findings.map((f, i) => (
        <li key={i} className={`flex gap-3 text-[13.5px] ${f.severity === "error" ? "text-shu" : "text-ink-2"}`}>
          <span className="label w-28 flex-none">{f.rule}</span><span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}
