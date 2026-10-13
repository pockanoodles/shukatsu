import Link from "next/link";
import type { Metadata } from "next";
import { allowed, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { formatDate, translator } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { ActionForm } from "@/components/system-forms";
import { createCampaignAction } from "@/app/actions/system";
import { homeZone, zones } from "@/lib/when";

export const metadata: Metadata = { title: "Fairs" };

type Campaign = { id: number; name: string; kind: string; venue: string | null; starts_on: string | null; ends_on: string | null; rows: number; next_deadline: string | null; archived_at: string | null; timezone: string };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view");
  const { t } = translator(user.lang);
  const archived = (await searchParams).archived === "1";
  const { campaigns } = await read<{ campaigns: Campaign[] }>("campaign.list", { archived });
  const canWrite = allowed(user, "campaign.write");
  const range = (c: Campaign) => [c.starts_on, c.ends_on].filter(Boolean).map((d) => formatDate(d, user.lang)).join(" – ");

  return (
    <div>
      <Head eyebrow="就活 · フォーラム" title={t("campaigns.title")} />
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          {campaigns.length === 0 ? <p className="px-4 py-8 text-ink-3 sm:px-10">{t("campaigns.none")}</p> : (
            <ol>
              {campaigns.map((c, i) => (
                <li key={c.id} className="border-b hair">
                  <Link href={`/campaigns/${c.id}`} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-5 hover:bg-paper-2 sm:px-10">
                    <span className="label row-span-3 pt-1 text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <span className="heading text-[22px]">{c.name}</span>
                    <span className="text-[14.5px] text-ink-2">{[c.venue, range(c)].filter(Boolean).join(" · ") || t(c.kind === "fair" ? "campaigns.kindFair" : "campaigns.kindCycle")}</span>
                    <span className="flex flex-wrap gap-x-5 gap-y-1">
                      <span className="label text-ink-2">{t("campaigns.rows", { n: c.rows })}</span>
                      <span className={`label ${c.next_deadline ? "text-shu" : "text-ink-3"}`}>
                        {c.next_deadline ? `${t("campaigns.nextDeadline")} ${formatDate(c.next_deadline, user.lang)}` : t("campaigns.noDeadline")}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <p className="px-4 py-4 sm:px-10">
            <Link href={archived ? "/campaigns" : "/campaigns?archived=1"} className="link text-[14px]">{archived ? t("campaigns.title") : t("campaigns.archived")}</Link>
          </p>
        </section>

        {canWrite && (
          <section className="grid content-start gap-5 px-4 py-8 sm:px-10">
            <h2 className="heading text-[22px]">{t("campaigns.new")}</h2>
            <ActionForm action={createCampaignAction} submit={t("campaigns.create")} pending={t("common.loading")} className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.name")}</span>
                <input name="name" required maxLength={120} className="field" placeholder="Career Forum 2026" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.kind")}</span>
                <select name="kind" className="field" defaultValue="fair"><option value="fair">{t("campaigns.kindFair")}</option><option value="cycle">{t("campaigns.kindCycle")}</option></select></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.venue")}</span><input name="venue" maxLength={200} className="field" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.startsOn")}</span><input name="starts_on" type="date" className="field" /></label>
              <label className="grid gap-1.5"><span className="label text-ink-2">{t("campaigns.endsOn")}</span><input name="ends_on" type="date" className="field" /></label>
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.url")}</span><input name="url" type="url" className="field" placeholder="https://" /></label>
              <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.timezone")}</span>
                <select name="timezone" className="field" defaultValue={homeZone()}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
              {campaigns.length > 0 && (
                <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{t("campaigns.copyFrom")}</span>
                  <select name="copy_from" className="field" defaultValue=""><option value="">{t("campaigns.copyNone")}</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              )}
            </ActionForm>
          </section>
        )}
      </div>
    </div>
  );
}
