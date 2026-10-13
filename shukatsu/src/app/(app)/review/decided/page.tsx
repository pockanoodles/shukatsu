import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { formatDate, translator } from "@/lib/i18n";
import { Flash, Stamp } from "@/components/marks";
import { reopenAction } from "@/app/actions/work";

export const metadata: Metadata = { title: "Decided" };

type Decided = { drafts: { key: string; kind: string; status: string; text: string; reason: string | null; decided_on: string | null; entity: { label: string } }[]; proposals: { id: number; kind: string; status: string; author_name: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; label?: string | null; payload: { text?: string; url?: string; label?: string; id?: string } }[] };

export default async function DecidedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.review");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { root, review } = await engine();
  const d: Decided = review.decided(root);
  const owner = allowed(user, "review.decide");
  const dateOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));
  return (
    <div>
      {sp.error && <Flash tone="shu">{sp.error}</Flash>}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 rule px-4 py-4 sm:px-10">
        <h1 className="display text-[34px] sm:text-[44px]">{t("review.decided")}</h1>
        <nav className="seg">
          <Link href="/review">{t("review.title")}</Link>
          <Link href="/review/decided" aria-current="page">{t("review.decided")}</Link>
        </nav>
      </div>
      <p className="border-b hair px-4 py-3 text-ink-2 sm:px-10">{t("review.decidedLead")}</p>
      {!d.drafts.length && !d.proposals.length && <p className="px-4 py-10 text-ink-2 sm:px-10">{t("review.decidedNone")}</p>}
      <ul>
        {d.drafts.map((x) => (
          <li key={x.key} className="grid gap-x-6 gap-y-2 border-b hair px-4 py-4 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:px-10">
            <span className="flex items-center gap-3">
              <Stamp size="sm" tone={x.status === "rejected" ? "ink" : "dashed"}>{x.status === "rejected" ? "却下" : "不明"}</Stamp>
              <span className="label text-ink-2">{t(`status.${x.status}`)}</span>
            </span>
            <div className="grid gap-1">
              <span className="code text-ink-3">{t(`review.kind.${x.kind}`)} · {x.entity.label}{x.decided_on ? ` · ${formatDate(dateOf(x.decided_on), user.lang)}` : ""}</span>
              <p className="text-ink-2" lang={x.kind === "ja" ? "ja" : undefined}>{x.text}</p>
              {x.reason && <p className="text-[14px]"><span className="label mr-2 text-ink-3">{t("review.reason")}</span>{x.reason}</p>}
            </div>
            {owner && (
              <form action={reopenAction} className="self-start"><input type="hidden" name="key" value={x.key} /><button className="btn btn-ghost btn-sm">{t("review.reopen")}</button></form>
            )}
          </li>
        ))}
        {d.proposals.map((pr) => (
          <li key={pr.id} className="grid gap-x-6 gap-y-2 border-b hair px-4 py-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:px-10">
            <span className="label self-start text-ink-2">{t(`today.proposalState.${pr.status}`)}</span>
            <div className="grid gap-1">
              <span className="code text-ink-3">{t(`review.kind.proposal.${pr.kind}`)} · {pr.author_name}{pr.decided_at ? ` · ${formatDate(pr.decided_at, user.lang)}` : ""}</span>
              <p className="text-ink-2">{pr.payload.text || pr.payload.label || pr.payload.url || pr.label || pr.payload.id}</p>
              {pr.decision_note && <p className="text-[14px]"><span className="label mr-2 text-ink-3">{t("review.reason")}</span>{pr.decision_note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
