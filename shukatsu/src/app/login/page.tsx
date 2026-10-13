import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { engine } from "@/lib/server/engine";
import { getLang, getUser } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { Bare } from "@/components/bare";
import { SignInForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getUser()) redirect("/today");
  const lang = await getLang();
  const { t } = translator(lang);
  const next = (await searchParams).next || "/today";
  const { root, people } = await engine();
  const fresh = !people.hasOwner(root);
  return (
    <Bare lang={lang} back="/login">
      <main className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="hidden border-r-2 rule px-10 py-10 lg:flex lg:flex-col lg:justify-between">
          <span className="label text-ink-2">就職活動</span>
          <span className="kanji text-[clamp(160px,17vw,260px)]">就活</span>
        </div>
        <div className="grid content-center px-4 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <h1 className="display text-[44px] sm:text-[56px]">{t("login.title")}</h1>
            <div className="mb-8" />
            {fresh && (
              <div role="status" className="mb-8 grid gap-3 border-2 border-shu p-4">
                <p className="heading text-[18px]">{t("login.setupTitle")}</p>
                <p className="text-[15px] text-ink-2">{t("login.setupLead")}</p>
                <code className="block overflow-x-auto bg-paper-2 px-3 py-2 font-mono text-[13px]">node shukatsu/people.mjs init --name &quot;Your Name&quot;</code>
                <p className="text-[13px] text-ink-3">{t("login.setupDaemon")}</p>
              </div>
            )}
            <SignInForm next={next} l={{
              login: t("login.login"), password: t("login.password"), submit: t("login.submit"), passkey: t("login.passkey"), or: t("login.or"),
              working: t("common.loading"), failed: t("login.passkey.failed"), cancelled: t("login.passkey.cancelled"),
            }} />
            <p className="mt-8 border-t hair pt-4 text-[14px] text-ink-3">{t("login.noAccount")}</p>
          </div>
        </div>
      </main>
    </Bare>
  );
}
