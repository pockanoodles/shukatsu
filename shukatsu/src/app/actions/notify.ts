"use server";

/**
 * Actions for LINE: the owner connecting it and sending the digest from the
 * connections page, and each person linking their own LINE account from
 * Settings. Each is one operation as the signed-in person.
 */

import { revalidatePath } from "next/cache";
import { op, out } from "@/lib/server/op";
import { getLang } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
const num = (form: FormData, k: string) => (form.get(k) == null || form.get(k) === "" ? undefined : Number(form.get(k)));
const schedule = (form: FormData) => ({ mode: str(form, "mode"), weekday: num(form, "weekday"), hour: num(form, "hour"), timezone: str(form, "timezone") });
const CONNECTIONS = "/settings/connectors";

export async function addLineAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const added = await op("connector.add", filled({ connector: "line", label: "LINE", channel_secret: str(form, "channel_secret"), channel_access_token: str(form, "channel_access_token"), ...schedule(form) }), "connectors.line.added");
  if (!added.ok) return out(added);
  // Check the token once now, which also learns the account's @id for the add-friend link.
  await op("connector.sync", { id: (added.data as { account: { id: number } }).account.id });
  revalidatePath(CONNECTIONS);
  return out(added);
}

export async function updateLineAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("id"));
  const r = await op("connector.update", filled({ id, channel_access_token: str(form, "channel_access_token"), ...schedule(form) }), "connectors.line.saved");
  // A new token is checked at once, so a bad paste shows now instead of tomorrow.
  if (r.ok && str(form, "channel_access_token")) await op("connector.sync", { id });
  if (r.ok) revalidatePath(CONNECTIONS);
  return out(r);
}

export async function sendLineAction(_: ActionResult | null): Promise<ActionResult> {
  const r = await op("notify.send", {});
  if (!r.ok) return out(r);
  const { t } = translator(await getLang());
  const d = r.data as { sent: number; failed: number; error: string | null };
  if (!d.sent && !d.failed) return { ok: true, message: t("connectors.line.sentNone") };
  return d.failed ? { ok: false, error: `${t("connectors.line.sent", { sent: d.sent, failed: d.failed })} ${d.error ?? ""}`.trim() } : { ok: true, message: t("connectors.line.sent", { sent: d.sent, failed: 0 }) };
}

export async function unlinkLineAction(form: FormData) {
  const id = num(form, "user_id");
  await op("notify.unlink", id ? { user_id: id } : {});
  revalidatePath(CONNECTIONS);
  revalidatePath("/settings");
}

export async function lineCodeAction(_: ActionResult | null): Promise<ActionResult> {
  const r = await op("notify.linkCode", {});
  return out(r);
}
