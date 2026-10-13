import Link from "next/link";
import { engine } from "@/lib/server/engine";
import { allowed, requireUser } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { NavLinks, ThemeToggle, type NavItem } from "@/components/client";
import { signOutAction, setLangAction } from "@/app/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t } = translator(user.lang);
  const { root, review } = await engine();
  const waiting = allowed(user, "view.review") ? review.summary(root) : null;
  const items: NavItem[] = [
    { href: "/today", label: t("nav.today") },
    // The same count the queue page shows, for everyone who can see it.
    ...(waiting ? [{ href: "/review", label: t("nav.review"), badge: waiting.total || undefined }] : []),
    { href: "/record", label: t("nav.record") },
    { href: "/applications", label: t("nav.applications") },
    { href: "/campaigns", label: t("sys.nav.campaigns") },
    ...(allowed(user, "calendar.read") ? [{ href: "/calendar", label: t("sys.nav.calendar") }] : []),
    ...(allowed(user, "inbox.read") ? [{ href: "/inbox", label: t("sys.nav.inbox") }] : []),
    ...(allowed(user, "view.review") ? [{ href: "/packets", label: t("nav.packets") }] : []),
    { href: "/digest", label: t("nav.digest") },
    ...(user.role === "owner" ? [{ href: "/people", label: t("nav.people") }] : []),
  ];
  const themeLabels = { system: t("theme.system"), light: t("theme.light"), dark: t("theme.dark"), switchTo: t("theme.switchTo") };
  return (
    <div className="flex min-h-dvh flex-col pb-[58px] md:pb-0">
      <a href="#main" className="label sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-ink focus:p-3 focus:text-on-ink">{t("nav.skip")}</a>
      <header className="sticky top-0 z-30 flex h-14 items-stretch border-b-2 rule bg-paper">
        <Link href="/today" className="flex items-center gap-2.5 border-r-2 rule px-4 sm:px-6" aria-label="shukatsu">
          <span className="display text-[22px]">Shukatsu</span>
          <span className="kanji text-[16px]">就活</span>
        </Link>
        <NavLinks items={items} variant="top" />
        <div className="ml-auto flex items-center">
          <form action={setLangAction} className="flex">
            <input type="hidden" name="lang" value={user.lang === "ja" ? "en" : "ja"} />
            <button type="submit" className="label h-14 px-3 text-ink-2 hover:text-ink" lang={user.lang === "ja" ? "en" : "ja"}>{t("lang.switch")}</button>
          </form>
          <ThemeToggle labels={themeLabels} />
          <details className="relative h-14 border-l-2 rule">
            <summary className="flex h-14 cursor-pointer list-none items-center gap-2 px-4" aria-label={t("nav.signedInAs", { name: user.name })}>
              <span className="grid h-7 w-7 place-items-center bg-ink text-[13px] font-bold text-on-ink">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="label hidden text-ink-2 lg:inline">{t(`role.${user.role}`)}</span>
            </summary>
            <div className="absolute right-0 top-[calc(100%+2px)] z-40 w-64 border-2 rule bg-paper">
              <div className="border-b hair px-4 py-3"><p className="font-bold">{user.name}</p><p className="label text-ink-3">{t(`role.${user.role}`)} · {user.login}</p></div>
              {allowed(user, "view.review") && <Link href="/activity" className="block border-b hair px-4 py-3 hover:bg-paper-2">{t("nav.activity")}</Link>}
              <Link href="/settings" className="block border-b hair px-4 py-3 hover:bg-paper-2">{t("nav.settings")}</Link>
              {allowed(user, "connector.manage") && <Link href="/settings/connectors" className="block border-b hair px-4 py-3 hover:bg-paper-2">{t("connectors.title")}</Link>}
              {allowed(user, "agent.manage") && <Link href="/settings/agents" className="block border-b hair px-4 py-3 hover:bg-paper-2">{t("sys.nav.agents")}</Link>}
              <form action={signOutAction}><button className="w-full px-4 py-3 text-left hover:bg-paper-2">{t("nav.signOut")}</button></form>
            </div>
          </details>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      {/* The phone bar holds five: the day, the queue, and what a fair week runs on. */}
      <NavLinks items={["/today", "/review", "/applications", "/campaigns", "/calendar"].map((h) => items.find((i) => i.href === h)).filter((i): i is NavItem => Boolean(i)).slice(0, 5)} variant="bottom" />
    </div>
  );
}
