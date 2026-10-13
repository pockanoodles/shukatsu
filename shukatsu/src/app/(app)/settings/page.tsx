import type { Metadata } from "next";
import { engine, ENGINE_DIR } from "@/lib/server/engine";
import { requestOrigin, requireUser } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { AddPasskey } from "@/components/auth-forms";
import { endSessionAction, removePasskeyAction } from "@/app/actions/work";
import { AccountForm, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const device = (ua: string | null) => {
  if (!ua) return "–";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
};

export default async function SettingsPage() {
  const user = await requireUser();
  const { t } = translator(user.lang);
  const { root, people, passkeys, llm, gitlog } = await engine();
  const keys: { id: string; name: string | null; device_type: string; created_at: string; last_used_at: string | null }[] = passkeys.passkeysFor(root, user.id);
  const sessions: { token_hash: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; method: string }[] = people.sessionsFor(root, user.id);
  // Browsers allow passkeys over HTTPS, or on localhost (never on a bare IP like 127.0.0.1).
  const here = new URL(process.env.SHUKATSU_URL || (await requestOrigin()));
  const https = here.protocol === "https:" || here.hostname === "localhost" || here.hostname.endsWith(".localhost");
  return (
    <div>
      <Head title={t("settings.title")} />
      <div className="grid lg:grid-cols-2">
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10 lg:border-r-2">
          <h2 className="heading text-[22px]">{t("settings.account")}</h2>
          <AccountForm name={user.name} email={user.email || ""} lang={user.lang} l={{ name: t("settings.name"), email: t("settings.email"), language: t("settings.language"), save: t("common.save"), working: t("common.loading") }} />
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10">
          <h2 className="heading text-[22px]">{t("settings.password")}</h2>
          <PasswordForm l={{ current: t("settings.currentPassword"), next: t("settings.newPassword"), change: t("settings.changePassword"), working: t("common.loading") }} />
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10 lg:border-r-2">
          <h2 className="heading text-[22px]">{t("settings.passkeys")}</h2>
          {keys.length === 0 ? <p className="text-ink-3">{t("settings.passkeyNone")}</p> : (
            <ul className="border-t hair">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-4 border-b hair py-3">
                  <span>{k.name || k.device_type}<span className="label ml-3 text-ink-3">{relative(k.last_used_at || k.created_at, user.lang)}</span></span>
                  <form action={removePasskeyAction}><input type="hidden" name="id" value={k.id} /><button className="label text-ink-2 underline underline-offset-4">{t("common.remove")}</button></form>
                </li>
              ))}
            </ul>
          )}
          {https ? <AddPasskey l={{ name: t("settings.passkeyName"), add: t("settings.addPasskey"), added: t("settings.passkeyAdded"), failed: t("login.passkey.failed"), working: t("common.loading") }} />
            : <p className="text-[14px] text-ink-3">{t("settings.passkeyHttps")}</p>}
        </section>
        <section className="grid content-start gap-5 border-b-2 rule px-4 py-8 sm:px-10">
          <h2 className="heading text-[22px]">{t("settings.sessions")}</h2>
          <ul className="border-t hair">
            {sessions.map((s) => (
              <li key={s.token_hash} className="flex flex-wrap items-center justify-between gap-3 border-b hair py-3">
                <span className="grid gap-0.5">
                  <span>{device(s.user_agent)} {s.token_hash === user.session.hash && <span className="label ml-2 text-shu">{t("settings.thisDevice")}</span>}</span>
                  <span className="label text-ink-3">{t(`settings.method.${s.method}`)} · {relative(s.last_seen_at, user.lang)}</span>
                </span>
                {s.token_hash !== user.session.hash && <form action={endSessionAction}><input type="hidden" name="hash" value={s.token_hash} /><button className="label text-ink-2 underline underline-offset-4">{t("settings.signOutOther")}</button></form>}
              </li>
            ))}
          </ul>
        </section>
        {user.role === "owner" && (
          <section className="grid content-start gap-4 border-b-2 rule px-4 py-8 sm:px-10 lg:col-span-2">
            <h2 className="heading text-[22px]">{t("settings.system")}</h2>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="label text-ink-3">{t("settings.url")}</dt><dd className="code break-all">{here.origin}</dd>
              <dt className="label text-ink-3">{t("settings.dataRoot")}</dt><dd className="code break-all">{root}</dd>
              <dt className="label text-ink-3">Engine</dt><dd className="code break-all">{ENGINE_DIR}</dd>
              <dt className="label text-ink-3">{t("settings.ai")}</dt><dd>{llm.llmEnabled() ? t("settings.aiOn", { model: llm.MODEL }) : t("settings.aiOff")}</dd>
              <dt className="label text-ink-3">{t("settings.git")}</dt><dd>{gitlog.gitEnabled(root) ? t("settings.gitOn") : t("settings.gitOff")}</dd>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
