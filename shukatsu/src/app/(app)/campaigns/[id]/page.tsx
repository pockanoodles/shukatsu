import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allowed, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { formatDate, translator, type T, type Lang } from "@/lib/i18n";
import { Flash, Head } from "@/components/marks";
import { ActionForm } from "@/components/system-forms";
import { archiveCampaignAction, campaignEventAction, eventStateAction, linkRowAction, unlinkRowAction, updateCampaignAction } from "@/app/actions/system";
import { dayKey, fmtDay, fmtTime, homeZone, hoursLeft, leftText, when, zones, zoneShort, type CalEvent } from "@/lib/when";

export const metadata: Metadata = { title: "Fair" };

type Row = { tracker_num: number; channel: string | null; company: string | null; role: string | null; status: string | null; missing: boolean; next_deadline: CalEvent | null; slots: CalEvent[]; packet: { id: number; status: string; lang: string } | null };
type Campaign = {
  id: number; name: string; kind: string; url: string | null; venue: string | null; timezone: string; starts_on: string | null; ends_on: string | null; notes: string | null; archived_at: string | null;
  rows: Row[]; deadlines: CalEvent[]; slots: CalEvent[]; days: CalEvent[]; other: CalEvent[];
};
type TrackerRow = { num: number; company: string; role: string; status: string };

/** The time an event reads in the candidate's zone, and as posted when that differs. */
function Time({ e, lang, t, urgent = false }: { e: CalEvent; lang: Lang; t: T; urgent?: boolean }) {
  const w = when(e, lang);
  return (
    <span className="grid gap-0.5">
      <span className={urgent ? "text-shu" : ""}>{w.day}{w.time ? ` · ${w.time}` : ` · ${t("sys.when.allDay")}`}</span>
      {w.posted && <span className="label text-ink-3">{t("sys.when.asPosted")} {w.posted}</span>}
    </span>
  );
}

const stateLabel = (t: T, s: string | null) => (s ? t(`state.${s.toLowerCase()}`) : "–");

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view");
  const { t } = translator(user.lang);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const sp = await searchParams;
  let c: Campaign;
  try { c = await read<Campaign>("campaign.get", { id }); } catch { notFound(); }
  const canWrite = allowed(user, "campaign.write");
  const tracker = canWrite ? (await read<{ rows: TrackerRow[] }>("tracker.list")).rows : [];
  const linked = new Set(c.rows.map((r) => r.tracker_num));
  const unlinked = tracker.filter((r) => !linked.has(r.num));
  const company = new Map(c.rows.map((r) => [r.tracker_num, r.company]));
  const tz = homeZone();
  const urgent = (e: CalEvent | null) => Boolean(e && !e.done_at && hoursLeft(e) < 72);

  // Fair days and slots by the day they fall on, with what sits too close together.
  const byDay = new Map<string, CalEvent[]>();
  for (const e of [...c.days, ...c.slots].filter((x) => !x.cancelled_at)) {
    const k = dayKey(e, tz);
    byDay.set(k, [...(byDay.get(k) || []), e]);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const gapNote = (list: CalEvent[], i: number) => {
    const a = list[i], b = list[i + 1];
    if (!b || a.all_day || b.all_day) return null;
    const end = Date.parse(a.ends_at || a.starts_at) + (a.ends_at ? 0 : 3_600_000);
    const gap = (Date.parse(b.starts_at) - end) / 60_000;
    if (gap < 0) return { tone: "shu", text: t("campaigns.overlap") };
    if (gap < 30) return { tone: "shu", text: t("campaigns.tight", { n: Math.round(gap) }) };
    return null;
  };
  const range = [c.starts_on, c.ends_on].filter(Boolean).map((d) => formatDate(d, user.lang)).join(" – ");

  return (
    <div>
      {sp.done === "created" && <Flash>{t("campaigns.created")}</Flash>}
      <Head eyebrow={t(c.kind === "fair" ? "campaigns.kindFair" : "campaigns.kindCycle")} title={c.name}
        lead={[c.venue, range, `${t("campaigns.timezone")} ${zoneShort(c.timezone)}`].filter(Boolean).join(" · ")}>
        <div className="flex flex-wrap items-center gap-3">
          {c.url && <a href={c.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm">{t("campaigns.url")} ↗</a>}
          {canWrite && (
            <form action={archiveCampaignAction}>
              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="archived" value={c.archived_at ? "0" : "1"} />
              <button className="btn btn-ghost btn-sm">{c.archived_at ? t("campaigns.unarchive") : t("campaigns.archive")}</button>
            </form>
          )}
        </div>
      </Head>

      {/* Applications: the fair's ledger. */}
      <section className="border-b-2 rule">
        <div className="px-4 pb-3 pt-7 sm:px-10">
          <h2 className="heading text-[22px]">{t("campaigns.applications")}</h2>
          <p className="mt-1 text-[14.5px] text-ink-2">{t("campaigns.applicationsLead")}</p>
        </div>
        {c.rows.length === 0 ? <p className="px-4 pb-6 text-ink-3 sm:px-10">{t("campaigns.applicationsNone")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[14.5px]">
              <thead>
                <tr className="label text-ink-2">
                  {(["num", "company", "role", "status", "channel", "packet", "deadline"] as const).map((k) => <th key={k} scope="col" className="border-y-2 rule px-4 py-2.5 font-normal first:pl-4 sm:first:pl-10">{t(`campaigns.cols.${k}`)}</th>)}
                  {canWrite && <th className="border-y-2 rule" />}
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.tracker_num} className="border-b hair align-top">
                    <td className="label px-4 py-3 text-ink-3 sm:pl-10">{String(r.tracker_num).padStart(3, "0")}</td>
                    <td className="px-4 py-3 font-bold">{r.company || "–"}</td>
                    <td className="max-w-[260px] px-4 py-3 text-ink-2">{r.role || "–"}</td>
                    <td className="label px-4 py-3">{stateLabel(t, r.status)}</td>
                    <td className="px-4 py-3 text-ink-2">{r.channel || "–"}</td>
                    <td className="px-4 py-3">{r.packet ? <Link className="link" href={`/packets/${r.packet.id}`}>{t(`campaigns.packet.${r.packet.status}`)}{r.packet.lang === "ja" ? " · 日本語" : ""}</Link> : <span className="text-ink-3">{t("campaigns.packet.none")}</span>}</td>
                    <td className="px-4 py-3">{r.next_deadline ? <Time e={r.next_deadline} lang={user.lang} t={t} urgent={urgent(r.next_deadline)} /> : <span className="text-ink-3">–</span>}</td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <form action={unlinkRowAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="tracker_num" value={r.tracker_num} /><button className="label text-ink-3 underline underline-offset-4">{t("campaigns.unlink")}</button></form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canWrite && (
          <details className="border-t hair px-4 py-4 sm:px-10">
            <summary className="label cursor-pointer text-ink-2">{t("campaigns.link")}</summary>
            <div className="mt-4 max-w-2xl">
              {unlinked.length === 0 ? <p className="text-ink-3">{t("campaigns.linkedNone")}</p> : (
                <ActionForm action={linkRowAction} submit={t("campaigns.linkSubmit")} pending={t("common.loading")} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.linkPick")}</span>
                    <select name="tracker_num" required className="field">{unlinked.map((r) => <option key={r.num} value={r.num}>#{r.num} {r.company} · {r.role}</option>)}</select></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.channel")}</span>
                    <input name="channel" maxLength={80} className="field" list="channels" />
                    <datalist id="channels"><option value="CareerForum.Net" /><option value="Avature" /><option value="Workday" /><option value="Handshake" /><option value="NUworks" /><option value="Company site" /></datalist>
                    <span className="text-[13px] text-ink-3">{t("campaigns.channelHelp")}</span></label>
                </ActionForm>
              )}
            </div>
          </details>
        )}
      </section>

      <div className="grid lg:grid-cols-2">
        {/* Deadlines, soonest first, each in its own zone and in yours. */}
        <section className="grid content-start gap-4 border-b-2 rule px-4 py-7 sm:px-10 lg:border-r-2">
          <h2 className="heading text-[22px]">{t("campaigns.deadlines")}</h2>
          {c.deadlines.filter((e) => !e.cancelled_at).length === 0 ? <p className="text-ink-3">{t("campaigns.deadlinesNone")}</p> : (
            <ul className="border-t hair">
              {c.deadlines.filter((e) => !e.cancelled_at).map((e) => (
                <li key={e.id} className={`grid gap-2 border-b hair py-3 sm:grid-cols-[minmax(0,1fr)_auto] ${e.done_at ? "text-ink-3" : ""}`}>
                  <span className="grid gap-1">
                    <span className={e.done_at ? "line-through" : "font-bold"}>{e.title}</span>
                    {e.tracker_num && <span className="label text-ink-3">#{e.tracker_num} {company.get(e.tracker_num) || ""}</span>}
                    <Time e={e} lang={user.lang} t={t} urgent={urgent(e)} />
                    {!e.done_at && <span className={`label ${urgent(e) ? "text-shu" : "text-ink-3"}`}>{hoursLeft(e) < 0 ? t("sys.when.overdue") : leftText(e, user.lang)}</span>}
                  </span>
                  {canWrite && (
                    <span className="flex items-start gap-3">
                      <form action={eventStateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="change" value={e.done_at ? "undo" : "done"} /><input type="hidden" name="back" value={`/campaigns/${c.id}`} />
                        <button className="btn btn-ghost btn-sm">{e.done_at ? t("campaigns.undo") : t("campaigns.done")}</button></form>
                      <form action={eventStateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="change" value="cancel" /><input type="hidden" name="back" value={`/campaigns/${c.id}`} />
                        <button className="label pt-2 text-ink-3 underline underline-offset-4">{t("campaigns.cancel")}</button></form>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <details>
              <summary className="label cursor-pointer text-ink-2">{t("campaigns.addDeadline")}</summary>
              <div className="mt-4">
                <ActionForm action={campaignEventAction} submit={t("campaigns.addDeadline")} pending={t("common.loading")} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value="deadline" />
                  <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.deadlineTitle")}</span><input name="title" required maxLength={200} className="field" /></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.deadlineAt")}</span><input name="start" type="datetime-local" required className="field" /></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.timezone")}</span>
                    <select name="timezone" className="field" defaultValue={c.timezone}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
                  <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.forRow")}</span>
                    <select name="tracker_num" className="field" defaultValue=""><option value="">{t("campaigns.forNone")}</option>{c.rows.map((r) => <option key={r.tracker_num} value={r.tracker_num}>#{r.tracker_num} {r.company}</option>)}</select></label>
                </ActionForm>
              </div>
            </details>
          )}
        </section>

        {/* The fair days as a day sheet: slots in order, with tight gaps marked. */}
        <section className="grid content-start gap-4 border-b-2 rule px-4 py-7 sm:px-10">
          <h2 className="heading text-[22px]">{t("campaigns.days")}</h2>
          {days.length === 0 ? <p className="text-ink-3">{t("campaigns.daysNone")}</p> : days.map(([day, list]) => {
            const sorted = [...list].sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
            return (
              <div key={day} className="border-t-2 rule">
                <p className="label py-2 text-ink-2">{fmtDay(day, user.lang)}</p>
                <ol>
                  {sorted.map((e, i) => {
                    const gap = gapNote(sorted, i);
                    return (
                      <li key={e.id} className="border-t hair">
                        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2.5">
                          <span className="label pt-0.5 text-ink-2">{e.all_day ? t("sys.when.allDay") : `${fmtTime(e.starts_at, user.lang, tz)}${e.ends_at ? `–${fmtTime(e.ends_at, user.lang, tz)}` : ""}`}</span>
                          <span className="grid gap-0.5">
                            <span className={e.kind === "fair" ? "heading text-[17px]" : "font-bold"}>{e.title}</span>
                            <span className="text-[13.5px] text-ink-2">{[e.tracker_num ? `#${e.tracker_num} ${company.get(e.tracker_num) || ""}` : null, e.round, e.location].filter(Boolean).join(" · ")}</span>
                          </span>
                        </div>
                        {gap && <p className={`label pb-2 pl-[9.75rem] ${gap.tone === "shu" ? "text-shu" : "text-ink-3"}`}>{gap.text}</p>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
          {canWrite && (
            <details>
              <summary className="label cursor-pointer text-ink-2">{t("campaigns.addSlot")} · {t("campaigns.addDay")}</summary>
              <div className="mt-4">
                <ActionForm action={campaignEventAction} submit={t("calendar.addSubmit")} pending={t("common.loading")} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.kind")}</span>
                    <select name="kind" className="field" defaultValue="interview"><option value="interview">{t("sys.kind.interview")}</option><option value="fair">{t("sys.kind.fair")}</option></select></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.slotTitle")}</span><input name="title" required maxLength={200} className="field" /></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.start")}</span><input name="start" type="datetime-local" required className="field" /></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.end")}</span><input name="end" type="datetime-local" className="field" /></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.forRow")}</span>
                    <select name="tracker_num" className="field" defaultValue=""><option value="">{t("campaigns.forNone")}</option>{c.rows.map((r) => <option key={r.tracker_num} value={r.tracker_num}>#{r.tracker_num} {r.company}</option>)}</select></label>
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.round")}</span><input name="round" maxLength={60} className="field" placeholder="1st · 1次面接" /></label>
                  <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.location")}</span><input name="location" maxLength={300} className="field" /></label>
                </ActionForm>
              </div>
            </details>
          )}
        </section>
      </div>

      {canWrite && (
        <details className="border-b-2 rule px-4 py-5 sm:px-10">
          <summary className="label cursor-pointer text-ink-2">{c.name} · {t("common.edit")}</summary>
          <div className="mt-4 max-w-2xl">
            <ActionForm action={updateCampaignAction} submit={t("common.save")} pending={t("common.loading")} reset={false} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={c.id} />
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.name")}</span><input name="name" defaultValue={c.name} required maxLength={120} className="field" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.venue")}</span><input name="venue" defaultValue={c.venue || ""} className="field" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.timezone")}</span>
                <select name="timezone" className="field" defaultValue={c.timezone}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.startsOn")}</span><input name="starts_on" type="date" defaultValue={c.starts_on || ""} className="field" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.endsOn")}</span><input name="ends_on" type="date" defaultValue={c.ends_on || ""} className="field" /></label>
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.url")}</span><input name="url" type="url" defaultValue={c.url || ""} className="field" /></label>
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.notes")}</span><textarea name="notes" defaultValue={c.notes || ""} rows={4} className="field" /></label>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
