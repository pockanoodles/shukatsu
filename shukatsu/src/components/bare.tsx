import Link from "next/link";
import { translator, type Lang } from "@/lib/i18n";
import { ThemeToggle } from "./client";
import { setLangAction } from "@/app/actions/auth";

/** The frame for pages outside the app: the landing page, sign-in, invites. */
export function Bare({ lang, back, children, right }: { lang: Lang; back: string; children: React.ReactNode; right?: React.ReactNode }) {
  const { t } = translator(lang);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-stretch border-b-2 rule bg-paper">
        <Link href="/" className="flex items-center gap-2.5 px-4 sm:px-10" aria-label="shukatsu">
          <span className="display text-[24px]">Shukatsu</span>
          <span className="kanji text-[16px]">就活</span>
        </Link>
        <div className="ml-auto flex items-center">
          {right}
          <form action={setLangAction} className="flex">
            <input type="hidden" name="lang" value={lang === "ja" ? "en" : "ja"} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className="label h-14 px-3 text-ink-2 hover:text-ink" lang={lang === "ja" ? "en" : "ja"}>{t("lang.switch")}</button>
          </form>
          <ThemeToggle labels={{ system: t("theme.system"), light: t("theme.light"), dark: t("theme.dark"), switchTo: t("theme.switchTo") }} />
        </div>
      </header>
      {children}
    </div>
  );
}
