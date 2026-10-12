import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireUser } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import type { Activity, PipelineItem, TrackerRow } from "@/lib/types";
import { Flash, Stamp } from "@/components/marks";
import { ActivityLine } from "@/components/activity";

export const metadata: Metadata = { title: "Today" };

const ACTIVE = new Set(["applied", "responded", "interview", "offer"]);

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { root, packets, proposals, review, store, tracker } = await engine();
  const owner = user.role === "owner";
  const sum = allowed(user, "view.review") ? review.summary(root) : null;
  const pks: { status: string }[] = packets.listPackets(root);
  const count = (s: string) => pks.filter((p) => p.status === s).length;
  const rows: TrackerRow[] = tracker.readTracker(root).rows;
  const inbox: PipelineItem[] = tracker.readPipeline(root).filter((x: PipelineItem) => x.state === "pending");
  const others: Activity[] = store.recentActivity(root, { limit: 40 }).filter((a: Activity) => a.actor_id !== user.id && !a.verb.startsWith("person.") && !a.verb.startsWith("invite.")).slice(0, 8);
  const mine = owner ? [] : proposals.proposalsBy(root, user.id).slice(0, 8);

  return (
    <div>
      {sp.denied && <Flash tone="shu">{t("common.denied")}</Flash>}
      <section className="grid border-b-2 rule lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-between gap-8 border-b-2 rule px-4 py-8 sm:px-10 lg:border-b-0 lg:border-r-2">
          <div>
            <p className="label text-ink-2">{new Intl.DateTimeFormat(user.lang === "ja" ? "ja-JP" : "en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
            <h1 className="display mt-3 text-[48px] sm:text-[64px]">{t("today.title")}</h1>
            <p className="mt-4 text-[17px] text-ink-2">{t("today.hello", { name: user.name.split(" ")[0] })}</p>
          </div>
          {owner && sum ? (
            <Link href="/review" className="group grid gap-4 border-2 rule p-5 hover:bg-paper-2">
              <span className="label text-ink-2">{t("today.waitingTitle")}</span>
              <span className="flex items-end justify-between gap-4">
                <span className="display num text-[88px] leading-[0.8] text-shu">{sum.total}</span>
                {sum.total ? <Stamp tone="shu" two>確認<br />待ち</Stamp> : <Stamp tone="ink">完了</Stamp>}
              </span>
              <span className="text-[15px] text-ink-2">{sum.total ? t("today.waitingLead", { n: sum.total, people: sum.fromPeople }) : t("today.waitingNone")}</span>
              <span className="label text-ink">{t("today.review")} →</span>
            </Link>
          ) : (
            <div className="grid gap-3">
              <span className="label text-ink-2">{t("today.helperTitle")}</span>
              {allowed(user, "suggest.posting") && <Link href="/applications#suggest" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperSuggest")} →</span><span className="text-[14px] text-ink-2">{t("today.helperSuggestLead")}</span></Link>}
              {allowed(user, "packet.create") && <Link href="/packets/new" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperPacket")} →</span><span className="text-[14px] text-ink-2">{t("today.helperPacketLead")}</span></Link>}
              {allowed(user, "propose.profile") && <Link href="/record" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperFact")} →</span><span className="text-[14px] text-ink-2">{t("today.helperFactLead")}</span></Link>}
              <Link href="/digest" className="link mt-2 text-[15px]">{t("today.digest")} →</Link>
            </div>
          )}
        </div>

        <div className="grid content-start">
          <div className="grid border-b-2 rule sm:grid-cols-2">
            <Link href="/packets" className="grid gap-3 border-b-2 rule p-5 hover:bg-paper-2 sm:border-b-0 sm:border-r-2 sm:px-8">
              <span className="label text-ink-2">{t("today.packetsTitle")}</span>
              <ul className="grid gap-1.5 text-[15px]">
                <li className={count("in_review") ? "text-shu" : "text-ink-2"}>{t("today.inReview", { n: count("in_review") })}</li>
                <li>{t("today.ready", { n: count("ready") })}</li>
                <li className="text-ink-2">{t("today.drafting", { n: count("drafting") })}</li>
                {count("changes_requested") ? <li className="text-ink-2">{t("today.changes", { n: count("changes_requested") })}</li> : null}
              </ul>
            </Link>
            <Link href="/applications" className="grid gap-3 p-5 hover:bg-paper-2 sm:px-8">
              <span className="label text-ink-2">{t("today.appsTitle")}</span>
              <span className="display num text-[44px] leading-none">{rows.filter((r) => ACTIVE.has(r.status.toLowerCase())).length}</span>
              <ul className="grid gap-1 text-[14.5px] text-ink-2">
                <li>{t("today.tracked", { n: rows.length })}</li>
                <li>{t("today.inbox", { n: inbox.length })}</li>
              </ul>
            </Link>
          </div>

          {!owner && (
            <div className="border-b-2 rule px-4 py-6 sm:px-8">
              <h2 className="label mb-2 text-ink-2">{t("today.yourProposals")}</h2>
              {mine.length === 0 ? <p className="text-ink-3">{t("today.yourProposalsNone")}</p> : (
                <ul>
                  {mine.map((pr: { id: number; kind: string; status: string; created_at: string; decision_note: string | null; payload: { text?: string; url?: string; label?: string } }) => (
                    <li key={pr.id} className="grid gap-1 border-b hair py-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                      <span className="clamp-2">{pr.payload.text || pr.payload.label || pr.payload.url}</span>
                      <span className={`label sm:text-right ${pr.status === "open" ? "text-shu" : "text-ink-2"}`}>{t(`today.proposalState.${pr.status}`)}</span>
                      {pr.decision_note && <span className="text-[13.5px] text-ink-2 sm:col-span-2">“{pr.decision_note}”</span>}
                      <span className="label text-ink-3">{relative(pr.created_at, user.lang)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="px-4 py-6 sm:px-8">
            <h2 className="label mb-2 text-ink-2">{t("today.fromOthers")}</h2>
            {others.length === 0 ? <p className="text-ink-3">{t("today.fromOthersNone")}</p> : (
              <ul>{others.map((a) => <ActivityLine key={a.id} a={a} t={t} lang={user.lang} />)}</ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
