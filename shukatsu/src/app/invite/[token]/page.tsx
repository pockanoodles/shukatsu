import type { Metadata } from "next";
import { cookies } from "next/headers";
import { engine } from "@/lib/server/engine";
import { LANG_COOKIE, getLang } from "@/lib/server/session";
import { translator, type Lang } from "@/lib/i18n";
import { Bare } from "@/components/bare";
import { InviteForm } from "@/components/auth-forms";
import { Stamp } from "@/components/marks";

export const metadata: Metadata = { title: "Invite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { root, people } = await engine();
  const inv = people.peekInvite(root, token);
  // An invite in another language opens in that language, until the person picks one with the toggle.
  const picked = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = picked === "ja" || picked === "en" ? picked : inv?.user?.lang || inv?.lang || (await getLang());
  const { t } = translator(lang);
  const reset = Boolean(inv?.user_id);
  return (
    <Bare lang={lang} back={`/invite/${token}`}>
      <main className="grid flex-1 place-items-start px-4 py-12 sm:px-10">
        <div className="grid w-full max-w-xl gap-8">
          {!inv ? (
            <>
              <h1 className="display text-[40px]">{t("invite.title")}</h1>
              <p className="border-l-4 border-shu pl-4 text-[17px]">{t("invite.invalid")}</p>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="display text-[44px] sm:text-[56px]">{reset ? t("invite.resetTitle") : t("invite.title")}</h1>
                  {reset && <p className="mt-4 text-[17px] text-ink-2">{t("invite.resetLead", { name: inv.user.name })}</p>}
                </div>
                <Stamp tone="shu">招待</Stamp>
              </div>
              {!reset && (
                <div className="grid gap-1 border-2 rule p-4">
                  <span className="label text-ink-3">{t("invite.roleIs")}</span>
                  <span className="heading text-[20px]">{t(`role.${inv.role}`)}</span>
                </div>
              )}
              <InviteForm token={token} reset={reset} defaults={{ name: inv.name, lang }} l={{
                name: t("invite.name"), nameHelp: inv.role === "owner" ? "" : t("invite.nameHelp"), login: t("invite.login"), loginHelp: t("invite.loginHelp"),
                password: t("invite.password"), passwordHelp: t("invite.passwordHelp"), language: t("invite.language"),
                submit: reset ? t("invite.resetSubmit") : t("invite.submit"), working: t("common.loading"),
              }} />
            </>
          )}
        </div>
      </main>
    </Bare>
  );
}
