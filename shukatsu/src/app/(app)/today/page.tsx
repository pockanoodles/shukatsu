import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireUser } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import type { Activity, PipelineItem, TrackerRow } from "@/lib/types";
import { Flash, Stamp } from "@/components/marks";
import { ActivityLine } from "@/components/activity";
import { withLabels } from "@/lib/activity-labels";
import { withdrawProposalAction } from "@/app/actions/work";
import { read } from "@/lib/server/op";
import { hoursLeft, leftText, when, type CalEvent } from "@/lib/when";

export const metadata: Metadata = { title: "Today" };

const ACTIVE = new Set(["applied", "responded", "interview", "offer"]);

type LiveAsk = { id: number; item: "answer" | "ja"; status: string; asked_by_name: string; asked_of_name: string; created_at: string; base: { question?: string; heading?: string | null; en?: string } };

/** Asks still in play, as links to their page: what was asked of a helper, or what the candidate asked and who answered. */
function Asks({ list, owner, t, lang }: { list: LiveAsk[]; owner: boolean; t: (k: string, v?: Record<string, string | number>) => string; lang: "en" | "ja" }) {
  return (
    <ul className="grid">
      {list.map((k) => (
        <li key={k.id}>
          <Link href={`/ask/${k.id}`} className="grid gap-1 border-t hair py-3 hover:bg-paper-2">
            <span className="clamp-2 text-[15.5px]">{k.item === "answer" ? k.base.question : k.base.heading || k.base.en}</span>
            <span className={`label ${k.status === "answered" && owner ? "text-shu" : "text-ink-2"}`}>
              {owner ? `${k.asked_of_name} · ${t(`asks.state.${k.status}`)}` : `${t("asks.from", { name: k.asked_by_name })} · ${relative(k.created_at, lang)}`} →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { t } = translator(user.lang);
  const upcoming = allowed(user, "calendar.read") ? (await read<{ events: CalEvent[] }>("calendar.upcoming", { days: 21 })).events.slice(0, 6) : [];
  const sp = await searchParams;
  const { root, packets, proposals, review, store, tracker, asks } = await engine();
  const owner = user.role === "owner";
  const sum = allowed(user, "view.review") ? review.summary(root) : null;
  const pks: { status: string }[] = packets.listPackets(root);
  const count = (s: string) => pks.filter((p) => p.status === s).length;
  const rows: TrackerRow[] = tracker.readTracker(root).rows;
  const inbox: PipelineItem[] = tracker.readPipeline(root).filter((x: PipelineItem) => x.state === "pending");
  // What the people helping did is for those who can see the work; a viewer reads the digest instead.
  const sees = allowed(user, "view.review");
  const others = await withLabels<Activity>(sees ? store.recentActivity(root, { limit: 40 }).filter((a: Activity) => a.actor_id !== user.id && !a.verb.startsWith("person.") && !a.verb.startsWith("invite.")).slice(0, 8) : []);
  type Mine = { id: number; kind: string; status: string; created_at: string; decision_note: string | null; payload: { text?: string; url?: string; label?: string } };
  const mine: Mine[] = owner || !allowed(user, "propose.profile") && !allowed(user, "suggest.posting") ? [] : proposals.proposalsBy(root, user.id).slice(0, 8);
  const mineLabels: Record<string, string> = review.labelsFor(root, mine.map((p) => `proposal:${p.id}`));
  // Answered first: for the candidate that is what needs them, for a helper it is already done.
  const liveAsks: LiveAsk[] = sees ? (asks.listAsks(root, user, { status: "live" }) as LiveAsk[])
    .sort((a, b) => (owner ? Number(b.status === "answered") - Number(a.status === "answered") : Number(a.status === "answered") - Number(b.status === "answered"))) : [];

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
            <div className="grid gap-4">
            <Link href="/review" className="group grid gap-4 border-2 rule p-5 hover:bg-paper-2">
              <span className="label text-ink-2">{t("today.waitingTitle")}</span>
              <span className="flex items-end justify-between gap-4">
                <span className="display num text-[88px] leading-[0.8] text-shu">{sum.total}</span>
                {sum.total ? <Stamp tone="shu" two>確認<br />待ち</Stamp> : <Stamp tone="ink">完了</Stamp>}
              </span>
              <span className="label text-ink">{t("today.review")} →</span>
            </Link>
            {liveAsks.length > 0 && (
              <div className="grid gap-1">
                <span className="label text-ink-2">{t("asks.today.owner")}{liveAsks.some((k) => k.status === "answered") && <span className="ml-2 text-shu">{t("asks.today.ownerAnswered", { n: liveAsks.filter((k) => k.status === "answered").length })}</span>}</span>
                <Asks list={liveAsks} owner t={t} lang={user.lang} />
              </div>
            )}
            </div>
          ) : (
            <div className="grid gap-3">
              {liveAsks.length > 0 && (
                <div className="grid gap-1 border-2 border-shu p-4">
                  <span className="label text-shu">{t("asks.today.mine")} · {liveAsks.filter((k) => k.status === "open").length}</span>
                  <Asks list={liveAsks} owner={false} t={t} lang={user.lang} />
                </div>
              )}
              <span className="label text-ink-2">{t("today.helperTitle")}</span>
              {allowed(user, "suggest.posting") && <Link href="/applications#suggest" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperSuggest")} →</span></Link>}
              {allowed(user, "packet.create") && <Link href="/packets/new" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperPacket")} →</span></Link>}
              {allowed(user, "propose.profile") && <Link href="/record" className="grid gap-1 border-2 rule p-4 hover:bg-paper-2"><span className="heading text-[18px]">{t("today.helperFact")} →</span></Link>}
              <Link href="/digest" className="link mt-2 text-[15px]">{t("today.digest")} →</Link>
            </div>
          )}
        </div>

        <div className="grid content-start">
          <div className={`grid border-b-2 rule ${sees ? "sm:grid-cols-2" : ""}`}>
            {sees && <Link href="/packets" className="grid gap-3 border-b-2 rule p-5 hover:bg-paper-2 sm:border-b-0 sm:border-r-2 sm:px-8">
              <span className="label text-ink-2">{t("today.packetsTitle")}</span>
              <ul className="grid gap-1.5 text-[15px]">
                <li className={count("in_review") ? "text-shu" : "text-ink-2"}>{t("today.inReview", { n: count("in_review") })}</li>
                <li>{t("today.ready", { n: count("ready") })}</li>
                <li className="text-ink-2">{t("today.drafting", { n: count("drafting") })}</li>
                {count("changes_requested") ? <li className="text-ink-2">{t("today.changes", { n: count("changes_requested") })}</li> : null}
              </ul>
            </Link>}
            <Link href="/applications" className="grid gap-3 p-5 hover:bg-paper-2 sm:px-8">
              <span className="label text-ink-2">{t("today.appsTitle")}</span>
              <span className="flex items-baseline gap-3"><span className="display num text-[44px] leading-none">{rows.filter((r) => ACTIVE.has(r.status.toLowerCase())).length}</span><span className="label text-ink-2">{t("today.inPlayLabel")}</span></span>
              <ul className="grid gap-1 text-[14.5px] text-ink-2">
                <li>{t("today.tracked", { n: rows.length })}</li>
                <li>{t("today.inbox", { n: inbox.length })}</li>
              </ul>
            </Link>
          </div>

          {allowed(user, "calendar.read") && (
            <div className="border-b-2 rule px-4 py-6 sm:px-8">
              <h2 className="label mb-2 flex justify-between text-ink-2"><span>{t("sys.upcoming")}</span><Link href="/calendar" className="link normal-case">{t("sys.nav.calendar")} →</Link></h2>
              {upcoming.length === 0 ? <p className="text-ink-3">{t("sys.upcomingNone")}</p> : (
                <ul>
                  {upcoming.map((e) => {
                    const w = when(e, user.lang);
                    const soon = e.kind === "deadline" && hoursLeft(e) < 72;
                    return (
                      <li key={e.id} className="grid gap-0.5 border-b hair py-2.5 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                        <span className={`label pt-0.5 ${soon ? "text-shu" : "text-ink-2"}`}>{w.day}</span>
                        <span className="grid gap-0.5">
                          <span><span className={`label mr-2 ${soon ? "text-shu" : "text-ink-3"}`}>{t(`sys.kind.${e.kind}`)}</span><span className="font-bold">{e.title}</span></span>
                          <span className={`text-[13.5px] ${soon ? "text-shu" : "text-ink-2"}`}>{w.time || t("sys.when.allDay")}{e.kind === "deadline" ? ` · ${leftText(e, user.lang)}` : ""}</span>
                          {w.posted && <span className="label text-ink-3">{t("sys.when.asPosted")} {w.posted}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!owner && (allowed(user, "propose.profile") || allowed(user, "suggest.posting")) && (
            <div className="border-b-2 rule px-4 py-6 sm:px-8">
              <h2 className="label mb-2 text-ink-2">{t("today.yourProposals")}</h2>
              {mine.length === 0 ? <p className="text-ink-3">{t("today.yourProposalsNone")}</p> : (
                <ul>
                  {mine.map((pr) => (
                    <li key={pr.id} className="grid gap-1 border-b hair py-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                      <span className="clamp-2">{pr.payload.text || pr.payload.label || pr.payload.url || mineLabels[`proposal:${pr.id}`]}{pr.kind === "fact.retire" ? <span className="label ml-2 text-ink-3">{t("today.retiring")}</span> : null}</span>
                      <span className={`label sm:text-right ${pr.status === "open" ? "text-shu" : "text-ink-2"}`}>{t(`today.proposalState.${pr.status}`)}</span>
                      {pr.decision_note && <span className="text-[13.5px] text-ink-2 sm:col-span-2">“{pr.decision_note}”</span>}
                      <span className="label flex items-center gap-4 text-ink-3 sm:col-span-2">{relative(pr.created_at, user.lang)}
                        {pr.status === "open" && <form action={withdrawProposalAction}><input type="hidden" name="id" value={pr.id} /><button className="label text-ink-2 underline underline-offset-4 hover:text-ink">{t("today.withdraw")}</button></form>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {sees && <div className="px-4 py-6 sm:px-8">
            <h2 className="label mb-2 text-ink-2">{t("today.fromOthers")}</h2>
            {others.length === 0 ? <p className="text-ink-3">{t("today.fromOthersNone")}</p> : (
              <ul>{others.map((a) => <ActivityLine key={a.id} a={a} t={t} lang={user.lang} />)}</ul>
            )}
          </div>}
        </div>
      </section>
    </div>
  );
}
