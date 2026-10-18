import type { Metadata } from "next";
import Link from "next/link";
import { requestOrigin, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator } from "@/lib/i18n";
import { ConfirmSubmit, CopyButton } from "@/components/client";
import { Flash, Head } from "@/components/marks";
import { weekdayNames, zoneShort } from "@/lib/when";
import { unlinkLineAction } from "@/app/actions/notify";
import { AccountButtons, BrowserForm, FeedForm, GmailForm, LineForm, LineSettingsForm, PurgeForm, SendLineForm } from "./forms";

export const metadata: Metadata = { title: "Connections" };

type Account = {
  id: number; connector: string; label: string; settings: { host?: string; client_id?: string; mode?: "nudge" | "full"; weekday?: number; hour?: number; timezone?: string }; status: "ok" | "needs_auth" | "error" | "paused";
  last_sync_at: string | null; has_error: boolean; records: number; open_signals: number;
};
type Listing = { accounts: Account[]; open_signals: number; untrusted: { errors: Record<string, string> } };
type Linked = {
  line: { connected: boolean; add_friend_url: string | null };
  people: { user_id: number; name: string; role: string; linked_at: string; active: boolean }[];
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("connector.manage");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const list = await read<Listing>("connector.list");
  const linked = await read<Linked>("notify.recipients");
  const origin = new URL(process.env.SHUKATSU_URL || (await requestOrigin())).origin;
  const redirect = `${origin}/connectors/gmail/callback`;
  const feeds = list.accounts.filter((a) => a.connector === "ics-in");
  const mail = list.accounts.filter((a) => a.connector === "gmail");
  const browser = list.accounts.filter((a) => a.connector === "browser");
  const lineAcct = list.accounts.find((a) => a.connector === "line");
  const names: Record<string, string> = { gmail: t("connectors.gmail.title"), "ics-in": t("connectors.feeds.title"), browser: t("connectors.browser.title"), line: t("connectors.line.title") };
  const webhook = `${origin}/connectors/line/webhook`;
  const days = weekdayNames(user.lang);
  const modes = { nudge: t("connectors.line.modes.nudge"), full: t("connectors.line.modes.full") };
  const lineL = Object.fromEntries(["secret", "token", "newToken", "mode", "weekday", "hour", "timezone", "add", "save", "sendNow", "sendConfirm"].map((k) => [k, t(`connectors.line.${k}`)]));
  const lineSettings = { mode: lineAcct?.settings.mode || "nudge", weekday: lineAcct?.settings.weekday ?? 0, hour: lineAcct?.settings.hour ?? 9, timezone: lineAcct?.settings.timezone || "Asia/Tokyo" };
  const botId = linked.line.add_friend_url ? decodeURIComponent(linked.line.add_friend_url.split("/").pop() || "") : null;
  const copied = list.accounts.some((a) => a.records > 0);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const acct = Object.fromEntries(["sync", "syncing", "pause", "resume", "remove", "removeConfirm"].map((k) => [k, t(`connectors.account.${k}`)]));

  const Row = ({ a, detail }: { a: Account; detail: string }) => (
    <li className="grid gap-3 border-b hair py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="font-medium">{a.label}<span className="label ml-3 text-ink-3">{detail}</span></span>
        <span className={`label ${a.status === "ok" ? "text-ink-2" : "text-shu"}`}>{t(`connectors.account.status.${a.status}`)}</span>
      </div>
      <p className="label text-ink-3">
        {a.last_sync_at ? t("connectors.account.lastSync", { when: relative(a.last_sync_at, user.lang) }) : t("connectors.account.never")}
        {" · "}{t("connectors.account.records", { n: a.records })}
        {a.open_signals > 0 && <>{" · "}<Link href="/inbox" className="underline underline-offset-4">{t("connectors.account.open", { n: a.open_signals })}</Link></>}
      </p>
      {a.has_error && list.untrusted.errors[String(a.id)] && <p className="text-[14px] text-shu break-words">{t("connectors.account.error", { error: list.untrusted.errors[String(a.id)] })}</p>}
      <AccountButtons id={a.id} paused={a.status === "paused"} push={a.connector === "browser"} connect={a.connector === "gmail" && (a.status === "needs_auth" || a.status === "error") ? `/connectors/gmail/start?account=${a.id}` : null} l={{ ...acct, connect: a.status === "needs_auth" && !a.last_sync_at ? t("connectors.gmail.connect") : t("connectors.gmail.reconnect") }} />
    </li>
  );

  return (
    <div>
      {sp.connected && <Flash>{t("connectors.connected")}</Flash>}
      {sp.error && <Flash tone="shu">{sp.error}</Flash>}
      <Head eyebrow={t("connectors.eyebrow")} title={t("connectors.title")} />
      <div className="grid lg:grid-cols-2">
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10 lg:border-r-2">
          <h2 className="heading text-[22px]">{t("connectors.feeds.title")}</h2>
          <div className="grid gap-1">
            <h3 className="label text-ink-2">{t("connectors.feeds.howTitle")}</h3>
            <p className="max-w-xl text-[15px] text-ink-2">{t("connectors.feeds.how")}</p>
          </div>
          {feeds.length === 0 ? <p className="text-ink-3">{t("connectors.feeds.none")}</p> : (
            <ul className="border-t hair">{feeds.map((a) => <Row key={a.id} a={a} detail={t("connectors.feeds.host", { host: a.settings.host })} />)}</ul>
          )}
          <FeedForm zone={zone} l={{ url: t("connectors.feeds.url"), urlHint: t("connectors.feeds.urlHint"), label: t("connectors.feeds.label"), labelPlaceholder: t("connectors.feeds.labelPlaceholder"), timezone: t("connectors.feeds.timezone"), add: t("connectors.feeds.add"), working: t("common.loading") }} />
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10">
          <h2 className="heading text-[22px]">{t("connectors.gmail.title")}</h2>
          <div className="grid gap-1">
            <h3 className="label text-ink-2">{t("connectors.gmail.stepsTitle")}</h3>
            <p className="max-w-xl text-[15px] text-ink-2">{t("connectors.gmail.steps")}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="label text-ink-2">{t("connectors.gmail.redirect")}</span>
            <div className="flex flex-wrap items-center gap-3"><code className="code break-all">{redirect}</code><CopyButton text={redirect} label={t("common.copy")} done={t("common.copied")} /></div>
          </div>
          <div className="grid gap-1 border-l-2 rule pl-4">
            <h3 className="label text-shu">{t("connectors.gmail.testingTitle")}</h3>
            <p className="max-w-xl text-[15px] text-ink-2">{t("connectors.gmail.testing")}</p>
          </div>
          {mail.length === 0 ? <p className="text-ink-3">{t("connectors.gmail.none")}</p> : (
            <ul className="border-t hair">{mail.map((a) => <Row key={a.id} a={a} detail={t("connectors.gmail.client", { id: (a.settings.client_id || "").slice(0, 12) })} />)}</ul>
          )}
          <GmailForm l={{ clientId: t("connectors.gmail.clientId"), clientSecret: t("connectors.gmail.clientSecret"), label: t("connectors.gmail.label"), labelPlaceholder: t("connectors.gmail.labelPlaceholder"), add: t("connectors.gmail.add"), working: t("common.loading") }} />
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10 lg:col-span-2">
          <h2 className="heading text-[22px]">{t("connectors.browser.title")}</h2>
          <div className="grid max-w-3xl gap-1">
            <h3 className="label text-ink-2">{t("connectors.browser.stepsTitle")}</h3>
            <p className="text-[15px] text-ink-2">{t("connectors.browser.steps")}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="label text-ink-2">{t("connectors.browser.address")}</span>
            <div className="flex flex-wrap items-center gap-3"><code className="code break-all">{origin}</code><CopyButton text={origin} label={t("common.copy")} done={t("common.copied")} /></div>
          </div>
          <div className="grid max-w-3xl gap-1 border-l-2 rule pl-4">
            <h3 className="label text-shu">{t("connectors.browser.keptTitle")}</h3>
            <p className="text-[15px] text-ink-2">{t("connectors.browser.kept")}</p>
          </div>
          {browser.length === 0 ? <BrowserForm l={{ add: t("connectors.browser.add"), working: t("common.loading") }} /> : (
            <ul className="border-t hair">{browser.map((a) => <Row key={a.id} a={a} detail={t("connectors.browser.detail")} />)}</ul>
          )}
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10 lg:col-span-2">
          <h2 className="heading text-[22px]">{t("connectors.line.title")}</h2>
          <p className="max-w-3xl text-[15px] text-ink-2">{t("connectors.line.lead")}</p>
          <div className="grid max-w-3xl gap-1">
            <h3 className="label text-ink-2">{t("connectors.line.stepsTitle")}</h3>
            <p className="text-[15px] text-ink-2">{t("connectors.line.steps")}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="label text-ink-2">{t("connectors.line.webhook")}</span>
            <div className="flex flex-wrap items-center gap-3"><code className="code break-all">{webhook}</code><CopyButton text={webhook} label={t("common.copy")} done={t("common.copied")} /></div>
            <p className="max-w-3xl text-[14px] text-ink-3">{t("connectors.line.webhookHow")}</p>
          </div>
          <div className="grid max-w-3xl gap-1 border-l-2 rule pl-4">
            <h3 className="label text-shu">{t("connectors.line.keptTitle")}</h3>
            <p className="text-[15px] text-ink-2">{t("connectors.line.kept")}</p>
          </div>
          {!lineAcct ? <LineForm days={days} modes={modes} l={{ ...lineL, working: t("common.loading") }} /> : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="grid content-start gap-5">
                <ul className="border-t hair">
                  <Row a={lineAcct} detail={t("connectors.line.detail", { id: botId || t("connectors.line.noId"), mode: modes[lineSettings.mode] })} />
                </ul>
                <p className="label text-ink-3">{t("connectors.line.schedule", { day: days[lineSettings.weekday], hour: lineSettings.hour, zone: zoneShort(lineSettings.timezone) })}</p>
                <LineSettingsForm id={lineAcct.id} v={lineSettings} days={days} modes={modes} l={{ ...lineL, working: t("common.loading") }} />
              </div>
              <div className="grid content-start gap-4">
                <h3 className="label text-ink-2">{t("connectors.line.people")}</h3>
                {linked.people.length === 0 ? <p className="text-ink-3">{t("connectors.line.nobody")}</p> : (
                  <ul className="border-t hair">
                    {linked.people.map((p) => (
                      <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 border-b hair py-3">
                        <span>{p.name}<span className="label ml-3 text-ink-3">{p.active ? relative(p.linked_at, user.lang) : t("connectors.line.noAccess")}</span></span>
                        <form action={unlinkLineAction}><input type="hidden" name="user_id" value={p.user_id} /><ConfirmSubmit message={t("connectors.line.unlinkConfirm")} className="label text-ink-2 underline underline-offset-4">{t("connectors.line.unlink")}</ConfirmSubmit></form>
                      </li>
                    ))}
                  </ul>
                )}
                {linked.line.add_friend_url && (
                  <div className="grid gap-1.5">
                    <span className="label text-ink-2">{t("connectors.line.addFriend")}</span>
                    <div className="flex flex-wrap items-center gap-3"><code className="code break-all">{linked.line.add_friend_url}</code><CopyButton text={linked.line.add_friend_url} label={t("common.copy")} done={t("common.copied")} /></div>
                  </div>
                )}
                <SendLineForm l={lineL} />
              </div>
            </div>
          )}
        </section>
        <section className="grid content-start gap-4 border-b-2 rule px-4 py-8 sm:px-10 lg:col-span-2">
          <h2 className="heading text-[22px]">{t("connectors.data.title")}</h2>
          {copied ? (
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {[...new Set(list.accounts.filter((a) => a.records > 0).map((a) => a.connector))].map((c) => (
                <PurgeForm key={c} connector={c} label={t("connectors.data.purgeOne", { name: names[c] || c })} confirm={t("connectors.data.purgeConfirm")} />
              ))}
              <PurgeForm label={t("connectors.data.purgeAll")} confirm={t("connectors.data.purgeConfirm")} ghost={false} />
            </div>
          ) : <p className="text-ink-3">{t("connectors.data.none")}</p>}
        </section>
      </div>
    </div>
  );
}
