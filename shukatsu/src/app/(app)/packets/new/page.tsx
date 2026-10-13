import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { requireCan } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { NewPacketForm } from "../forms";

export const metadata: Metadata = { title: "New packet" };

export default async function NewPacketPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("packet.create");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { root, facts } = await engine();
  const p = facts.loadProfile(root);
  const archetypes = Object.entries(p.archetypes || {}).map(([id, a]) => ({ id, name: (a as { name: string }).name, tags: (a as { tags: string[] }).tags }));
  return (
    <div>
      <Head eyebrow={sp.url ? t("packets.form.from") : undefined} title={t("packets.new")} />
      <div className="max-w-4xl px-4 py-8 sm:px-10">
        <NewPacketForm archetypes={archetypes} defaults={{ url: sp.url || "", company: sp.company || "", role: sp.role || "", lang: sp.lang === "ja" || sp.lang === "en" ? sp.lang : "en" }} l={{
          company: t("packets.form.company"), role: t("packets.form.role"), url: t("packets.form.url"), jd: t("packets.form.jd"), jdHelp: t("packets.form.jdHelp"),
          archetype: t("packets.form.archetype"), lang: t("packets.form.lang"), submit: t("packets.form.submit"), working: t("common.loading"),
          langEn: t("packets.langEn"), langJa: t("packets.langJa"), langHelp: t("packets.langHelp"),
        }} />
      </div>
    </div>
  );
}
