"use server";

/**
 * Actions for the connections page. Each is one operation as the signed-in
 * person: adding, removing, and purging are stamps the registry only accepts
 * from a person's own session, and syncing runs the same fetch the schedule does.
 */

import { revalidatePath } from "next/cache";
import { op, out } from "@/lib/server/op";
import { getLang } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
const PAGE = "/settings/connectors";

type Synced = { ok: boolean; records?: number; added?: number; error?: string };

export async function addFeedAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const added = await op("connector.add", filled({ connector: "ics-in", label: str(form, "label"), url: str(form, "url"), timezone: str(form, "timezone") }));
  if (!added.ok) return out(added);
  const { t } = translator(await getLang());
  const id = (added.data as { account: { id: number } }).account.id;
  // Fetch it once now, so the person sees whether the address works.
  const first = await op("connector.sync", { id });
  revalidatePath(PAGE);
  const s = first.ok ? (first.data as Synced) : null;
  if (s?.ok) return { ok: true, message: t("connectors.feeds.addedSynced", { n: s.records }) };
  return { ok: true, message: t("connectors.feeds.addedFailed", { error: s?.error || first.error }) };
}

export async function addGmailAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("connector.add", filled({ connector: "gmail", label: str(form, "label"), client_id: str(form, "client_id"), client_secret: str(form, "client_secret") }), "connectors.gmail.added");
  if (r.ok) revalidatePath(PAGE);
  return out(r);
}

export async function addBrowserAction(_: ActionResult | null): Promise<ActionResult> {
  const r = await op("connector.add", { connector: "browser" }, "connectors.browser.added");
  if (r.ok) revalidatePath(PAGE);
  return out(r);
}

export async function syncAccountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("connector.sync", { id: Number(form.get("id")) });
  revalidatePath(PAGE);
  if (!r.ok) return out(r);
  const s = r.data as Synced;
  const { t } = translator(await getLang());
  return s.ok ? { ok: true, message: t("connectors.account.synced", { added: s.added ?? 0 }) } : { ok: false, error: s.error };
}

export async function pauseAccountAction(form: FormData) {
  await op("connector.update", { id: Number(form.get("id")), paused: form.get("paused") === "1" });
  revalidatePath(PAGE);
}

export async function removeAccountAction(form: FormData) {
  await op("connector.remove", { id: Number(form.get("id")) });
  revalidatePath(PAGE);
}

export async function purgeAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const connector = str(form, "connector");
  const r = await op("connector.purge", connector ? { connector } : {});
  if (!r.ok) return out(r);
  revalidatePath(PAGE);
  const { t } = translator(await getLang());
  const d = r.data as { records: number; signals: number };
  return { ok: true, message: t("connectors.data.purged", { records: d.records, signals: d.signals }) };
}
