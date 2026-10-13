import Link from "next/link";
import { fill, relative, translator, type Lang, type T } from "@/lib/i18n";
import type { Activity } from "@/lib/types";

/** Where an activity's subject lives in the app. */
export function subjectHref(subject: string | null): string | null {
  if (!subject) return null;
  if (subject.startsWith("draft:") || subject.startsWith("proposal:")) return `/review?item=${encodeURIComponent(subject)}`;
  if (subject.startsWith("packet:")) return `/packets/${subject.slice(7)}`;
  if (subject.startsWith("fact:")) return `/record#${subject.slice(5)}`;
  if (subject.startsWith("app:")) return "/applications";
  return null;
}

function subjectLabel(a: Activity & { label?: string }): string {
  if (a.label) return a.label;
  const d = a.detail || {};
  if (a.subject?.startsWith("packet:") && d.company) return `${d.company}${d.role ? ` · ${d.role}` : ""}`;
  if (a.subject?.startsWith("draft:")) return a.subject.replace(/^draft:(fact|variant|ja|entity):/, "");
  return a.subject || "";
}

export function ActivityLine({ a, t, lang }: { a: Activity & { label?: string }; t: T; lang: Lang }) {
  // Verb keys contain dots (review.accept), so they're looked up whole, not as a path.
  const verbs = translator(lang).list<Record<string, string>>("activity.v");
  const href = subjectHref(a.subject);
  const actor = a.actor_name || t("activity.system");
  // A suggestion reads by what it suggests: a posting, a new fact, a rewording.
  const kindVerb = a.verb === "proposal.created" && typeof a.detail?.kind === "string" ? `proposal.created.${a.detail.kind}` : null;
  // Older feeds logged "ask for changes" on a packet as a rejection.
  const verb = a.verb === "review.reject" && a.subject?.startsWith("packet:") ? "review.changes" : kindVerb && verbs[kindVerb] ? kindVerb : a.verb;
  const text = verbs[verb] ? fill(verbs[verb], { actor, subject: subjectLabel(a) }) : fill(verbs.other, { actor, verb: a.verb });
  const excerpt = typeof a.detail?.excerpt === "string" ? a.detail.excerpt : typeof a.detail?.text === "string" ? a.detail.text : null;
  return (
    <li className="grid gap-1 border-b hair py-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-6">
      <div className="grid gap-1">
        {href ? <Link href={href} className="hover:underline">{text}</Link> : <span>{text}</span>}
        {excerpt && <span className="clamp-2 text-[13.5px] text-ink-2">“{excerpt}”</span>}
      </div>
      <span className="label text-ink-3 sm:text-right">{relative(a.created_at, lang)}</span>
    </li>
  );
}
