import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { requireUser } from "@/lib/server/session";
import { formatDate, translator, type Lang } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { CopyButton } from "@/components/client";

export const metadata: Metadata = { title: "Digest" };

type Move = { num: number; company: string; role: string; from: string; to: string; date: string };
type Digest = {
  period: { from: string; to: string; days: number };
  applications: { sent: Move[]; movement: Move[]; active: number; total: number };
  packets: { ready: { id: number; company: string; role: string }[]; inReview: { id: number; company: string; role: string }[]; changes: { id: number }[]; drafting: { id: number }[]; sentThisWeek: number };
  review: { total: number; fromPeople: number; confirmed: number; rejected: number; unsure: number };
  pipeline: { pending: number; suggested: number };
  contributors: { name: string; n: number }[];
};

export default async function DigestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const days = [7, 14, 30].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const textLang: Lang = sp.text === "en" || sp.text === "ja" ? sp.text : user.lang;
  const { root, digest } = await engine();
  const d: Digest = digest.digest(root, { days });
  const text: string = digest.digestText(d, textLang);
  const st = (s: string) => { const k = s.toLowerCase(); const v = t(`state.${k}`); return v === `state.${k}` ? s : v; };
  const Big = ({ n, label, tone = "" }: { n: number; label: string; tone?: string }) => (
    <div className="grid gap-1 border-b-2 rule p-5 sm:border-b-0 sm:border-r-2 sm:px-8 sm:last:border-r-0">
      <span className={`display num text-[56px] leading-none ${tone}`}>{n}</span><span className="label text-ink-2">{label}</span>
    </div>
  );
  return (
    <div>
      <Head eyebrow={t("digest.period", { from: formatDate(d.period.from, user.lang), to: formatDate(d.period.to, user.lang) })} title={t("digest.title")} lead={t("digest.lead")}>
        <nav className="seg" aria-label={t("digest.title")}>
          {[7, 14, 30].map((n) => (
            <Link key={n} href={`/digest?days=${n}`} aria-current={n === days ? "page" : undefined}>{t("digest.days", { n })}</Link>
          ))}
        </nav>
      </Head>
      <div className="grid border-b-2 rule sm:grid-cols-4">
        <Big n={d.applications.sent.length} label={t("digest.sent")} tone={d.applications.sent.length ? "text-shu" : ""} />
        <Big n={d.applications.active} label={t("digest.inPlay")} />
        <Big n={d.review.total} label={t("digest.queue")} />
        <Big n={d.pipeline.pending} label={t("digest.inbox")} />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          <section className="border-b-2 rule px-4 py-6 sm:px-10">
            <h2 className="label mb-3 text-ink-2">{t("digest.sent")}</h2>
            {d.applications.sent.length === 0 ? <p className="text-ink-2">{t("digest.none")}</p> : (
              <ul>{d.applications.sent.map((a) => <li key={`${a.num}-${a.date}`} className="flex justify-between gap-4 border-b hair py-2.5"><span><b>{a.company}</b> · {a.role}</span><span className="label text-ink-3">{formatDate(a.date, user.lang)}</span></li>)}</ul>
            )}
          </section>
          {d.applications.movement.length > 0 && (
            <section className="border-b-2 rule px-4 py-6 sm:px-10">
              <h2 className="label mb-3 text-ink-2">{t("digest.movement")}</h2>
              <ul>{d.applications.movement.map((m) => <li key={`${m.num}-${m.date}-${m.to}`} className="grid gap-1 border-b hair py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]"><span><b>{m.company}</b> · {m.role}</span><span className="label">{st(m.from)} → {st(m.to)}</span></li>)}</ul>
            </section>
          )}
          <section className="grid gap-3 px-4 py-6 sm:px-10">
            <h2 className="label text-ink-2">{t("digest.packets")}</h2>
            <p>{t("today.ready", { n: d.packets.ready.length })} · {t("today.inReview", { n: d.packets.inReview.length })} · {t("today.drafting", { n: d.packets.drafting.length })}</p>
            <h2 className="label mt-3 text-ink-2">{t("digest.decided")}</h2>
            <p>{d.review.confirmed} {t("digest.confirmed")} · {d.review.rejected} {t("digest.rejected")} · {d.review.unsure} {t("digest.unsure")}</p>
            {d.contributors.length > 0 && <><h2 className="label mt-3 text-ink-2">{t("digest.helpers")}</h2><p>{d.contributors.map((c) => `${c.name} (${c.n})`).join(", ")}</p></>}
          </section>
        </div>
        <section className="grid content-start gap-4 px-4 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="label text-ink-2">{t("digest.textLang")}</span>
            <nav className="seg">
              {(["ja", "en"] as const).map((lg) => <Link key={lg} href={`/digest?days=${days}&text=${lg}`} aria-current={lg === textLang ? "page" : undefined}>{lg === "ja" ? "日本語" : "English"}</Link>)}
            </nav>
          </div>
          <pre lang={textLang} className="code scroll-thin overflow-x-auto whitespace-pre-wrap border-2 rule bg-paper-2 p-4 text-[13px] leading-[1.7]">{text}</pre>
          <CopyButton text={text} label={t("digest.copy")} done={t("common.copied")} className="btn btn-shu justify-self-start" />
        </section>
      </div>
    </div>
  );
}
