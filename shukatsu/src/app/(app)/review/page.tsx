import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { relative, translator, type T } from "@/lib/i18n";
import type { QueueItem } from "@/lib/types";
import { Claim, figureCount } from "@/components/claim";
import { Diff } from "@/components/diff";
import { Findings, Flash, Prov, Stamp } from "@/components/marks";
import { Comments } from "@/components/comments";
import { ReviewKeys } from "@/components/client";
import { Decide, type Outcome } from "./decide";

export const metadata: Metadata = { title: "Review" };

const groupOf = (it: QueueItem, t: T) => (it.source === "profile" ? it.entity?.label || t("review.drafted") : t("review.fromPeople"));

function question(it: QueueItem, t: T) {
  if (it.kind === "variant") return t("review.q.variant", { archetypes: (it.variant?.for || []).join(", ") });
  return t(`review.q.${it.kind}`, { name: it.author?.name || "" });
}

function outcomesFor(it: QueueItem, t: T): { outcomes: Outcome[]; rejectLink?: Outcome } {
  const o = (id: Outcome["id"], label: string, lead: string, key?: string, primary = false): Outcome => ({ id, label: t(`review.out.${label}`), lead: t(`review.out.${lead}`), key, primary });
  const reject = o("reject", "rejectLink", "rejectLead", "r");
  if (it.kind === "packet") return { outcomes: [o("approve", "approve", "approveLead", "a", true), o("changes", "changes", "changesLead", "r")] };
  if (it.kind === "proposal.posting") return { outcomes: [o("add", "add", "addLead", "a", true), o("reject", "reject", "rejectLead", "r")] };
  if (it.kind === "proposal.fact.retire") return { outcomes: [o("retire", "retire", "retireLead", "a", true), o("reject", "reject", "rejectLead", "r")] };
  if (it.kind === "entity" || it.kind === "proposal.entity.new") {
    return { outcomes: [o("accept", "accept", "acceptLead", "a", true), o("unsure", "unsure", "unsureLead", "u"), o("reject", "reject", "rejectLead", "r")] };
  }
  if (it.kind === "variant") return { outcomes: [o("accept", "accept", "acceptLead", "a", true), o("edit", "edit", "editLead", "e"), o("reject", "reject", "rejectLead", "r")] };
  if (it.hasNumbers && it.kind !== "ja") {
    return { outcomes: [o("accept", "accept", "acceptLead", "a", true), o("correct", "correct", "correctLead", "e"), o("narrative", "narrative", "narrativeLead", "n"), o("unsure", "unsure", "unsureLead", "u")], rejectLink: reject };
  }
  return { outcomes: [o("accept", "accept", "acceptLead", "a", true), o("edit", "edit", "editLead", "e"), o("unsure", "unsure", "unsureLead", "u")], rejectLink: reject };
}

function Warnings({ it, t }: { it: QueueItem; t: T }) {
  if (!it.warnings.length) return null;
  return (
    <ul className="grid gap-2">
      {it.warnings.map((w, i) => (
        <li key={i} className={`border-l-4 px-3 py-1.5 text-[14px] ${w.blocking || w.code === "stale" ? "border-shu text-shu" : "border-ink-3 text-ink-2"}`}>
          {t(`review.warn.${w.code}`, {
            entity: w.entity, current: w.current, added: w.diff?.added.join(", ") || "–", removed: w.diff?.removed.join(", ") || "–",
          })}
        </li>
      ))}
    </ul>
  );
}

function ItemCard({ it, next, user, t }: { it: QueueItem; next: string | null; user: Parameters<typeof Comments>[0]["user"]; t: T }) {
  const owner = allowed(user, "review.decide");
  const { outcomes, rejectLink } = outcomesFor(it, t);
  const showPath = allowed(user, "view.evidence-path");
  const isEdit = it.kind === "proposal.fact.edit" && it.before && it.after;
  const n = it.after ? figureCount(it.after) : 0;
  const ev = it.evidence;
  return (
    <article className="grid content-start gap-6 px-4 py-6 sm:px-10 sm:py-8" aria-labelledby="q">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/review" className="label text-ink-2 md:hidden">← {t("review.title")}</Link>
        {it.entity && <span className="label text-ink-2">{[it.entity.heading || it.entity.label, it.entity.title, it.entity.dates].filter(Boolean).join(" · ")}</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className={`label px-2 py-1 ${it.source === "profile" ? "border border-ink-3 text-ink-2" : "bg-ink text-on-ink"}`}>
          {it.source === "profile" ? t("review.drafted_from") : t("review.proposedBy", { name: it.author?.name || "" })}
        </span>
        {it.created_at && <span className="label text-ink-3">{relative(it.created_at, user.lang)}</span>}
        <span className="label text-ink-3">{t(`review.kind.${it.kind}`)}</span>
      </div>
      <h2 id="q" className="heading text-[26px] sm:text-[30px]">{question(it, t)}</h2>

      {it.kind === "packet" ? (
        <div className="grid gap-4">
          <p className="text-[18px]">{t("review.packetLead", { company: it.company || "", role: it.role || "" })}</p>
          <Link href={`/packets/${it.packet}`} className="btn btn-ghost justify-self-start">{t("review.packetOpen")} →</Link>
        </div>
      ) : it.kind === "proposal.posting" && it.posting ? (
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 border-2 rule p-4 text-[15px]">
          <dt className="label text-ink-3">{t("review.posting.link")}</dt><dd className="min-w-0 break-all"><a className="link" href={it.posting.url} target="_blank" rel="noreferrer noopener">{it.posting.url}</a></dd>
          {it.posting.company && <><dt className="label text-ink-3">{t("review.posting.company")}</dt><dd>{it.posting.company}</dd></>}
          {it.posting.role && <><dt className="label text-ink-3">{t("review.posting.role")}</dt><dd>{it.posting.role}</dd></>}
          {it.posting.note && <><dt className="label text-ink-3">{t("review.posting.note")}</dt><dd>{it.posting.note}</dd></>}
        </dl>
      ) : isEdit ? (
        <div className="grid gap-4">
          <div className="grid gap-1"><span className="label text-ink-3">{t("review.before")}</span><p className="text-[17px] text-ink-2"><Claim text={it.before!} /></p></div>
          <div className="grid gap-1"><span className="label text-shu">{t("review.after")}</span><p className="text-[21px] leading-[1.45]"><Diff before={it.before!} after={it.after!} /></p></div>
        </div>
      ) : it.kind === "ja" ? (
        <div className="grid gap-4">
          <p className="text-[15px] text-ink-2"><Claim text={it.before || ""} /></p>
          <p lang="ja" className="text-[21px] leading-[1.6]"><Claim text={it.after || ""} changed={it.warnings.find((w) => w.code === "ja-numbers")?.diff?.added} /></p>
        </div>
      ) : it.kind === "proposal.fact.retire" ? (
        <div className="grid gap-3">
          <p className="text-[19px] text-ink-2 line-through decoration-ink-3"><Claim text={it.before || ""} /></p>
          <p className="text-[15px]"><span className="label mr-3 text-ink-3">{t("review.reason")}</span>{it.reason}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {it.kind === "variant" && it.before && <p className="text-[15px] text-ink-2"><Claim text={it.before} /></p>}
          <p className="text-[21px] leading-[1.45]"><Claim text={it.after || ""} changed={it.kind === "variant" ? it.warnings.find((w) => w.code === "variant-numbers")?.diff?.added : undefined} /></p>
          {it.kind === "proposal.fact.new" && it.ja && <p lang="ja" className="text-[16px] text-ink-2">{it.ja}</p>}
        </div>
      )}

      {it.note && <p className="border-l-4 border-ink px-3 py-1 text-[14.5px]"><span className="label mr-3 text-ink-3">{t("review.note")}</span>{it.note}</p>}

      {ev && (ev.quote || ev.source) && (
        <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-2 border-2 rule p-4 text-[14.5px]">
          {ev.quote && <><dt className="label pt-0.5 text-ink-3">{t("review.evidence")}</dt><dd>“{ev.quote}”</dd></>}
          <dt className="label pt-0.5 text-ink-3">{t("review.source")}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Prov letter={it.fact?.provenance ?? null} t={t} />
            <span>{showPath && ev.source ? `${ev.source}${ev.line ? `, line ${ev.line}` : ""}` : t("review.sourceHidden")}</span>
            {it.fact?.provenance && <span className="text-ink-2">· {t(`prov.${it.fact.provenance}`)}</span>}
          </dd>
        </dl>
      )}

      <Warnings it={it} t={t} />
      {it.checks && it.kind !== "ja" && it.kind !== "entity" && it.kind !== "packet" && it.kind !== "proposal.posting" && it.kind !== "proposal.fact.retire" && it.kind !== "proposal.entity.new" && (
        <div className="flex flex-wrap items-start gap-4"><Findings findings={it.checks} t={t} />{it.after && <span className="label num text-ink-3">{t("common.chars", { n: [...it.after].length, max: 230 })}</span>}</div>
      )}

      <div className="grid gap-3 border-t-2 rule pt-5">
        {owner ? (
          <>
            {it.hasNumbers && it.kind !== "ja" && it.kind !== "variant" && <p className="font-bold">{n === 1 ? t("review.figuresOne") : t("review.figures", { n })}</p>}
            <Decide itemKey={it.key} next={next} outcomes={outcomes} rejectLink={rejectLink} text={it.after || ""}
              current={it.entity?.ended === false} checkRules={it.kind !== "ja"} stamp={t("review.done.accept")}
              labels={{
                reasonLabel: t("review.reasonLabel"), reasonPlaceholder: t("review.reasonPlaceholder"), editLabel: t("review.editLabel"),
                narrativeHelp: t("review.narrativeHelp"), correctHelp: t("review.correctHelp"), submitEdit: t("review.submitEdit"),
                submitNarrative: t("review.submitNarrative"), submitReject: t("review.submitReject"), submitChanges: t("review.submitChanges"),
                chars: t("common.chars"), pass: t("review.rules.pass"), figures: t("record.figuresChanged"), working: t("common.loading"),
              }} />
          </>
        ) : <p className="text-[15px] text-ink-2">{t("review.onlyOwner")}</p>}
      </div>

      <Comments subject={it.key} user={user} path="/review" />
    </article>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.review");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { root, review } = await engine();
  const items: QueueItem[] = review.queue(root);
  const current = items.find((x) => x.key === sp.item) || (sp.item ? null : items[0]) || items[0] || null;
  const idx = current ? items.indexOf(current) : -1;
  const next = idx >= 0 ? (items[idx + 1] || items[idx - 1] || null)?.key ?? null : null;
  const groups: [string, QueueItem[]][] = [];
  for (const it of items) {
    const g = groupOf(it, t);
    const last = groups.at(-1);
    if (last && last[0] === g) last[1].push(it);
    else groups.push([g, [it]]);
  }
  const done = sp.done && ["accept", "narrative", "cannot-confirm", "reject"].includes(sp.done) ? sp.done : null;
  const hasItem = Boolean(sp.item);
  // A link to an item that's been decided (or never existed) says so, instead of quietly opening another one.
  const gone = Boolean(sp.item && !sp.stamped && !items.some((x) => x.key === sp.item));
  const stampedLabel = sp.stamped ? (review.labelsFor(root, [sp.stamped]) as Record<string, string>)[sp.stamped] || "" : "";
  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <ReviewKeys keys={items.map((x) => x.key)} current={current?.key ?? null} />
      {gone && <Flash>{t("sys.reviewGone")}</Flash>}
      {done && (
        <Flash tone={done === "accept" ? "shu" : "ink"}>
          <span className="flex items-center gap-4">
            {done === "accept" && <Stamp size="sm" tone="on" press>確認</Stamp>}
            {done === "accept" ? null : t(`review.done.${done}`)}{stampedLabel ? <span className="clamp-2 normal-case opacity-80">{stampedLabel}</span> : null}
          </span>
        </Flash>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 rule px-4 py-4 sm:px-10">
        <div className="flex items-baseline gap-5">
          <h1 className="display text-[34px] sm:text-[44px]">{t("review.title")}</h1>
          <span className="label text-ink-2">{t("review.waiting", { n: items.length })}</span>
        </div>
        <nav className="seg" aria-label={t("review.title")}>
          <Link href="/review" aria-current="page">{t("review.waiting", { n: items.length })}</Link>
          <Link href="/review/decided">{t("review.decided")}</Link>
        </nav>
      </div>
      {items.length === 0 ? (
        <div className="grid flex-1 place-content-center gap-5 px-4 py-20 text-center">
          <div className="justify-self-center"><Stamp size="lg" tone="ink">完了</Stamp></div>
          <h2 className="heading text-[28px]">{t("review.empty")}</h2>
        </div>
      ) : (
        <div className="grid flex-1 md:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <aside className={`scroll-thin min-w-0 border-r-2 rule md:sticky md:top-14 md:block md:h-[calc(100dvh-56px-78px)] md:overflow-y-auto ${hasItem ? "hidden" : ""}`} aria-label={t("review.title")}>
            
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="label sticky top-0 z-10 flex justify-between border-b hair bg-paper-2 px-4 py-2 text-ink-2 sm:px-6"><span>{g}</span><span className="num">{list.length}</span></div>
                <ul>
                  {list.map((it) => {
                    const on = it.key === current?.key;
                    return (
                      <li key={it.key}>
                        <Link href={`/review?item=${encodeURIComponent(it.key)}`} data-item={it.key} aria-current={on ? "true" : undefined} scroll={false}
                          className={`grid min-w-0 gap-1.5 border-b hair px-4 py-3.5 sm:px-6 ${on ? "bg-ink text-on-ink" : "hover:bg-paper-2"}`}>
                          <span className="flex min-w-0 items-center justify-between gap-3">
                            <span className={`label truncate text-[11.5px] ${on ? "" : "text-ink-2"}`}>{t(`review.kind.${it.kind}`)}</span>
                            <span className="flex flex-none items-center gap-2">
                              {it.comments ? <span className="code text-[11px]">✎{it.comments}</span> : null}
                              {it.hasNumbers && <span className={`h-2 w-2 ${on ? "bg-on-ink" : "bg-shu"}`} aria-hidden />}
                            </span>
                          </span>
                          <span className={`clamp-2 min-w-0 break-words text-[13.5px] leading-snug ${on ? "opacity-85" : "text-ink-2"}`} lang={it.kind === "ja" ? "ja" : undefined}>{it.after || it.fact?.text || it.before}</span>
                          {it.author && <span className={`label text-[11px] ${on ? "opacity-75" : "text-ink-3"}`}>{it.author.name}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>
          <div className={hasItem ? "" : "hidden md:block"}>
            {current ? <ItemCard key={current.key} it={current} next={next} user={user} t={t} /> : <p className="p-10 text-ink-2">{t("review.select")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
