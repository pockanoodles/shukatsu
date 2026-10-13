import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { formatDate, translator } from "@/lib/i18n";
import type { PipelineItem, TrackerRow } from "@/lib/types";
import { Head } from "@/components/marks";
import { PostingForm, StatusForm } from "./forms";

export const metadata: Metadata = { title: "Applications" };

const stateKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

export default async function ApplicationsPage() {
  const user = await requireCan("view");
  const { t } = translator(user.lang);
  const { root, tracker } = await engine();
  const rows: TrackerRow[] = [...tracker.readTracker(root).rows].reverse();
  const inbox: PipelineItem[] = tracker.readPipeline(root).filter((x: PipelineItem) => x.state === "pending");
  const states: { id: string; label: string }[] = tracker.canonicalStates();
  const log: Map<string, { date: string; from: string; to: string }[]> = tracker.statusLog(root);
  const owner = user.role === "owner";
  const canWrite = allowed(user, "tracker.write");
  const canPacket = allowed(user, "packet.create");
  const stateLabel = (s: string) => { const k = stateKey(s); const v = t(`state.${k}`); return v === `state.${k}` ? s : v; };
  const l: Record<string, string> = {
    url: t("apps.url"), company: t("apps.company"), role: t("apps.role"), note: t("apps.note"), submit: t("apps.submit"), submitOwner: t("apps.submitOwner"),
    working: t("common.loading"), changeStatus: t("apps.changeStatus"),
    ...Object.fromEntries(states.map((s) => [`state_${s.id}`, t(`state.${s.id}`)])),
  };
  return (
    <div>
      <Head title={t("apps.title")} />
      <section aria-labelledby="tracker" className="border-b-2 rule">
        <h2 id="tracker" className="label border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("apps.tracker")} · {rows.length}</h2>
        {rows.length === 0 ? <p className="px-4 py-8 text-ink-2 sm:px-10">{t("apps.empty")}</p> : (
          <div className="scroll-thin relative overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="label text-ink-3">
                  {(["num", "date", "company", "role", "score", "status", "notes"] as const).map((c) => <th key={c} scope="col" className="border-b-2 rule px-4 py-2.5 font-normal first:pl-4 sm:first:pl-10">{t(`apps.cols.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const history = log.get(String(r.num)) || [];
                  return (
                    <tr key={r.num} className="border-b hair align-top">
                      <td className="code px-4 py-3 text-ink-3 sm:pl-10">{r.num}</td>
                      <td className="label num whitespace-nowrap px-4 py-3 text-ink-2">{formatDate(r.date, user.lang)}</td>
                      <td className="px-4 py-3 font-bold">{r.url ? <a className="hover:underline" href={r.url} target="_blank" rel="noreferrer noopener">{r.company}</a> : r.company}</td>
                      <td className="px-4 py-3">{r.role}</td>
                      <td className="code px-4 py-3">{r.score}</td>
                      <td className="px-4 py-3">
                        {canWrite ? <StatusForm num={r.num} current={r.status} states={states} l={l} /> : <span className="label">{stateLabel(r.status)}</span>}
                        {history.length > 0 && (
                          <details className="mt-1"><summary className="label cursor-pointer text-ink-3">{t("apps.history")} · {history.length}</summary>
                            <ol className="mt-1 grid gap-0.5 text-[12.5px] text-ink-2">{history.map((h, i) => <li key={i} className="num">{h.date} · {stateLabel(h.from)} → {stateLabel(h.to)}</li>)}</ol>
                          </details>
                        )}
                      </td>
                      <td className="max-w-[280px] px-4 py-3 text-[13.5px] text-ink-2">{r.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="inbox" className="grid grid-cols-[minmax(0,1fr)] border-b-2 rule lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          <h2 id="inbox" className="label border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("apps.inbox")} · {inbox.length}</h2>
          {inbox.length === 0 ? <p className="px-4 py-8 text-ink-2 sm:px-10">{t("apps.inboxEmpty")}</p> : (
            <ul>
              {inbox.map((x) => (
                <li key={`${x.line}-${x.url}`} className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-1 border-b hair px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-10">
                  <div className="grid min-w-0 gap-0.5">
                    <a href={x.url} target="_blank" rel="noreferrer noopener" className="truncate font-bold hover:underline">{x.company === "?" && x.role === "?" ? hostOf(x.url) : x.company} {x.role !== "?" || x.company !== "?" ? <span className="font-normal text-ink-2">· {x.role}</span> : null}</a>
                    <span className="flex flex-wrap gap-x-3 text-[12.5px] text-ink-3">
                      {x.location && <span>{x.location}</span>}
                      {x.posted && <span className="label">{t("apps.posted", { date: x.posted })}</span>}
                      {x.note && <span>{x.note}</span>}
                    </span>
                  </div>
                  {canPacket && (
                    <Link className="btn btn-ghost btn-sm self-center" href={`/packets/new?${new URLSearchParams({ url: x.url, company: x.company === "?" ? "" : x.company, role: x.role === "?" ? "" : x.role }).toString()}`}>{t("apps.build")}</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {allowed(user, "suggest.posting") && (
          <div id="suggest" className="scroll-mt-20 px-4 py-6 sm:px-10">
            <h2 className="heading text-[24px]">{owner ? t("apps.addOwner") : t("apps.suggest")}</h2>
            
            <PostingForm owner={owner} l={l} />
          </div>
        )}
      </section>
    </div>
  );
}
