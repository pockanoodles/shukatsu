import Link from "next/link";
import type { Metadata } from "next";
import { allowed, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator, type T } from "@/lib/i18n";
import { Flash, Head } from "@/components/marks";
import { dismissSignalAction, signalAction } from "@/app/actions/system";

export const metadata: Metadata = { title: "Inbox" };

type Action = { op: string; input: Record<string, unknown> };
type Signal = { id: number; kind: string; status: string; confidence: string; tracker_num: number | null; proposed: { actions?: Action[]; matched?: { company?: string; role?: string } | null; hints?: Record<string, string> } | null; created_at: string; record: { connector: string | null; received_at: string | null } };
type Item = { signal: number; from: string; subject: string; snippet: string };

/** What a proposed action would do, in words. */
function describe(a: Action, t: T) {
  if (a.op === "tracker.setStatus") return t("inbox.doStatus", { n: String(a.input.num), state: t(`state.${String(a.input.state).toLowerCase()}`) });
  if (a.op === "event.create") return t("inbox.doEvent", { title: String(a.input.title || "") });
  if (a.op === "posting.add") return t("inbox.doPosting");
  if (a.op === "posting.capture") return t("inbox.doCapture");
  return a.op;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("inbox.read");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { signals, untrusted } = await read<{ signals: Signal[]; untrusted: { items: Item[] } }>("inbox.list", { status: "open" });
  const text = new Map(untrusted.items.map((x) => [x.signal, x]));
  const canAct = allowed(user, "inbox.write");
  return (
    <div>
      {sp.done && <Flash>{t("common.saved")}</Flash>}
      {sp.error && <Flash tone="shu">{sp.error}</Flash>}
      <Head eyebrow="就活 · 受信" title={t("inbox.title")}>
        {allowed(user, "connector.manage") && <Link href="/settings/connectors" className="btn btn-ghost btn-sm">{t("inbox.connectors")}</Link>}
      </Head>
      {signals.length === 0 ? <p className="px-4 py-8 text-ink-3 sm:px-10">{t("inbox.none")}</p> : (
        <ol>
          {signals.map((s) => {
            const x = text.get(s.id);
            return (
              <li key={s.id} className="grid gap-3 border-b-2 rule px-4 py-5 sm:px-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10">
                <div className="grid content-start gap-1.5">
                  <p className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className={`label ${["interview", "assessment", "offer"].includes(s.kind) ? "text-shu" : "text-ink-2"}`}>{t(`inbox.kind.${s.kind}`)}</span>
                    {s.tracker_num && <span className="label text-ink-2">#{s.tracker_num} {s.proposed?.matched?.company || ""}</span>}
                    <span className="label text-ink-3">{relative(s.record.received_at || s.created_at, user.lang)}</span>
                  </p>
                  {/* Outside text: shown as text, never followed. */}
                  <p className="font-bold">{x?.subject || "–"}</p>
                  <p className="text-[14px] text-ink-2">{x?.from}</p>
                  {x?.snippet && <p className="clamp-2 text-[14px] text-ink-3">{x.snippet}</p>}
                </div>
                {canAct && (
                  <div className="flex flex-wrap content-start items-start gap-3">
                    {(s.proposed?.actions || []).map((a, i) => (
                      <form key={i} action={signalAction}>
                        <input type="hidden" name="id" value={s.id} /><input type="hidden" name="action" value={i} />
                        <button className="btn btn-sm">{describe(a, t)}</button>
                      </form>
                    ))}
                    <form action={dismissSignalAction}><input type="hidden" name="id" value={s.id} /><button className="btn btn-ghost btn-sm">{t("inbox.dismiss")}</button></form>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
