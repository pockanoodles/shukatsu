import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { allowed, requireCan } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import { Head } from "@/components/marks";

export const metadata: Metadata = { title: "Packets" };

type Row = { id: number; company: string; role: string; status: string; author_name: string; updated_at: string; archetype: string; sent_on: string | null };

export default async function PacketsPage() {
  const user = await requireCan("view");
  const { t } = translator(user.lang);
  const { root, packets } = await engine();
  const rows: Row[] = packets.listPackets(root);
  return (
    <div>
      <Head title={t("packets.title")} lead={t("packets.lead")}>
        {allowed(user, "packet.create") && <Link href="/packets/new" className="btn btn-shu">+ {t("packets.new")}</Link>}
      </Head>
      {rows.length === 0 ? <p className="px-4 py-10 text-ink-2 sm:px-10">{t("packets.empty")}</p> : (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/packets/${r.id}`} className="grid gap-x-6 gap-y-1 border-b hair px-4 py-4 hover:bg-paper-2 sm:grid-cols-[150px_minmax(0,1fr)_180px] sm:px-10">
                <span className={`label self-center ${r.status === "in_review" ? "text-shu" : r.status === "ready" ? "text-ink" : "text-ink-2"}`}>{t(`packets.status.${r.status}`)}</span>
                <span className="min-w-0"><span className="font-bold">{r.company}</span> <span className="text-ink-2">· {r.role}</span></span>
                <span className="label text-ink-3 sm:text-right">{r.author_name} · {relative(r.updated_at, user.lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
