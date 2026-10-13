import Link from "next/link";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { requireCan } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import type { Activity } from "@/lib/types";
import { Head } from "@/components/marks";
import { ActivityLine } from "@/components/activity";
import { withLabels } from "@/lib/activity-labels";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("view.review");
  const { t } = translator(user.lang);
  const before = Number((await searchParams).before) || null;
  const { root, store } = await engine();
  const list: Activity[] = store.recentActivity(root, { limit: 60, before });
  // People management is the owner's business; everyone else sees the search, not the admin.
  const shown = await withLabels(user.role === "owner" ? list : list.filter((a) => !a.verb.startsWith("person.") && !a.verb.startsWith("invite.")));
  return (
    <div>
      <Head title={t("activity.title")} />
      <div className="px-4 sm:px-10">
        {shown.length === 0 ? <p className="py-10 text-ink-2">{t("activity.none")}</p> : <ul>{shown.map((a) => <ActivityLine key={a.id} a={a} t={t} lang={user.lang} />)}</ul>}
        {list.length === 60 && <Link href={`/activity?before=${list.at(-1)!.id}`} className="btn btn-ghost btn-sm my-6">{t("activity.older")} →</Link>}
      </div>
    </div>
  );
}
