import type { Metadata } from "next";
import { allowed, requestOrigin, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { ActionForm } from "@/components/system-forms";
import { eventAction, eventStateAction, revokeTokenAction, tokenAction } from "@/app/actions/system";
import { dayKey, fmtDay, homeZone, hoursLeft, when, zones, type CalEvent } from "@/lib/when";

export const metadata: Metadata = { title: "Calendar" };

const KINDS = ["interview", "deadline", "followup", "fair", "task", "other"] as const;
type Token = { id: number; kind: string; name: string; created_at: string; last_used_at: string | null; user_id: number };

export default async function CalendarPage() {
  const user = await requireCan("calendar.read");
  const { t } = translator(user.lang);
  const days = 60;
  const { events } = await read<{ events: CalEvent[] }>("calendar.upcoming", { days });
  const canWrite = allowed(user, "calendar.write");
  const owner = user.role === "owner";
  const rows = canWrite ? (await read<{ rows: { num: number; company: string; role: string }[] }>("tracker.list")).rows : [];
  const feeds: Token[] = owner ? (await read<{ tokens: Token[] }>("token.list", { kinds: ["feed"] })).tokens.filter((x) => x.user_id === user.id) : [];
  const base = (process.env.SHUKATSU_URL || (await requestOrigin())).replace(/\/$/, "");

  const groups = new Map<string, CalEvent[]>();
  for (const e of events) groups.set(dayKey(e), [...(groups.get(dayKey(e)) || []), e]);

  return (
    <div>
      <Head eyebrow="就活 · 予定" title={t("calendar.title")} lead={t("calendar.lead")} />
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          {groups.size === 0 ? <p className="px-4 py-8 text-ink-3 sm:px-10">{t("calendar.none", { n: days })}</p> : [...groups.entries()].map(([day, list]) => (
            <div key={day} className="border-b-2 rule">
              <p className="label border-b hair px-4 py-2 text-ink-2 sm:px-10">{fmtDay(day, user.lang)}</p>
              <ol>
                {list.map((e) => {
                  const w = when(e, user.lang, homeZone());
                  const soon = e.kind === "deadline" && hoursLeft(e) < 72;
                  return (
                    <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b hair px-4 py-3 last:border-b-0 sm:px-10">
                      <span className="grid gap-0.5">
                        <span className="flex flex-wrap items-baseline gap-x-3">
                          <span className={`label ${soon ? "text-shu" : "text-ink-3"}`}>{t(`sys.kind.${e.kind}`)}</span>
                          <span className="font-bold">{e.title}</span>
                        </span>
                        <span className={`text-[14px] ${soon ? "text-shu" : "text-ink-2"}`}>{w.time || t("sys.when.allDay")}{e.location ? ` · ${e.location}` : ""}</span>
                        {w.posted && <span className="label text-ink-3">{t("sys.when.asPosted")} {w.posted}</span>}
                        {owner && e.meeting_url && <a href={e.meeting_url} className="link text-[14px]" target="_blank" rel="noreferrer noopener">{t("calendar.meeting")} ↗</a>}
                      </span>
                      {canWrite && (
                        <span className="flex items-start gap-3">
                          {(e.kind === "deadline" || e.kind === "task" || e.kind === "followup") && (
                            <form action={eventStateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="change" value="done" /><input type="hidden" name="back" value="/calendar" />
                              <button className="btn btn-ghost btn-sm">{t("campaigns.done")}</button></form>
                          )}
                          <form action={eventStateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="change" value="cancel" /><input type="hidden" name="back" value="/calendar" />
                            <button className="label pt-2 text-ink-3 underline underline-offset-4">{t("campaigns.cancel")}</button></form>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>

        <div className="grid content-start">
          {canWrite && (
            <section className="grid gap-4 border-b-2 rule px-4 py-7 sm:px-10">
              <h2 className="heading text-[22px]">{t("calendar.add")}</h2>
              <ActionForm action={eventAction} submit={t("calendar.addSubmit")} pending={t("common.loading")} className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.kind")}</span>
                  <select name="kind" className="field" defaultValue="interview">{KINDS.map((k) => <option key={k} value={k}>{t(`sys.kind.${k}`)}</option>)}</select></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.eventTitle")}</span><input name="title" required maxLength={200} className="field" /></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.start")}</span><input name="start" type="datetime-local" required className="field" /></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.end")}</span><input name="end" type="datetime-local" className="field" /></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.timezone")}</span>
                  <select name="timezone" className="field" defaultValue={homeZone()}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.app")}</span>
                  <select name="tracker_num" className="field" defaultValue=""><option value="">{t("calendar.appNone")}</option>{rows.map((r) => <option key={r.num} value={r.num}>#{r.num} {r.company}</option>)}</select></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.location")}</span><input name="location" maxLength={300} className="field" /></label>
                <label className="grid gap-1.5"><span className="label text-ink-2">{t("calendar.meeting")}</span><input name="meeting_url" type="url" maxLength={1000} className="field" /></label>
                <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("calendar.note")}</span><textarea name="note" rows={2} maxLength={2000} className="field" /></label>
              </ActionForm>
            </section>
          )}

          {owner && (
            <section className="grid gap-4 px-4 py-7 sm:px-10">
              <h2 className="heading text-[22px]">{t("calendar.subscribe")}</h2>
              <p className="text-[14.5px] text-ink-2">{t("calendar.subscribeLead")}</p>
              <ActionForm action={tokenAction} submit={t("calendar.makeFeed")} pending={t("common.loading")} buttonClass="btn btn-ghost"
                secret={{ lead: t("calendar.feedMade"), copy: t("calendar.copy"), copied: t("calendar.copied"), template: `${base}/cal/{token}.ics` }}>
                <input type="hidden" name="user_id" value={user.id} /><input type="hidden" name="kind" value="feed" /><input type="hidden" name="name" value={t("calendar.title")} />
              </ActionForm>
              <p className="text-[13px] text-ink-3">{t("calendar.howApple")}<br />{t("calendar.howGoogle")}</p>
              <p className="text-[13px] text-ink-3">{t("calendar.family")}</p>
              <h3 className="label mt-2 text-ink-2">{t("calendar.feeds")}</h3>
              {feeds.length === 0 ? <p className="text-ink-3">{t("calendar.feedsNone")}</p> : (
                <ul className="border-t hair">
                  {feeds.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-4 border-b hair py-3">
                      <span className="grid"><span>{f.name}</span><span className="label text-ink-3">{f.last_used_at ? t("calendar.lastUsed", { when: relative(f.last_used_at, user.lang) }) : t("calendar.neverUsed")}</span></span>
                      <form action={revokeTokenAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value="/calendar" /><button className="label text-ink-2 underline underline-offset-4">{t("calendar.revoke")}</button></form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
