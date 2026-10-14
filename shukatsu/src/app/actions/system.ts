"use server";

/**
 * Actions for the headless system's pages: campaigns, the calendar, agents
 * and tokens, and capture. Each is one operation as the signed-in person.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { op, out } from "@/lib/server/op";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const opt = (form: FormData, k: string) => (str(form, k) ? str(form, k) : undefined);
const int = (form: FormData, k: string) => (str(form, k) ? Number(str(form, k)) : undefined);
/** Only the fields that were filled in, so an op's defaults and "leave as is" both hold. */
const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

// ---------------------------------------------------------------- campaigns

export async function createCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("campaign.create", filled({
    name: str(form, "name"), kind: opt(form, "kind"), venue: opt(form, "venue"), url: opt(form, "url"), timezone: opt(form, "timezone"),
    starts_on: opt(form, "starts_on"), ends_on: opt(form, "ends_on"), notes: opt(form, "notes"), copy_from: int(form, "copy_from"),
  }));
  if (!r.ok) return out(r);
  revalidatePath("/campaigns");
  redirect(`/campaigns/${(r.data as { id: number }).id}?done=created`);
}

export async function updateCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("id"));
  const r = await op("campaign.update", {
    id, ...filled({ name: opt(form, "name"), venue: opt(form, "venue"), url: opt(form, "url"), timezone: opt(form, "timezone"), starts_on: opt(form, "starts_on"), ends_on: opt(form, "ends_on") }),
    ...(form.has("notes") ? { notes: str(form, "notes") } : {}),
  }, "campaigns.saved");
  if (r.ok) revalidatePath(`/campaigns/${id}`);
  return out(r);
}

export async function archiveCampaignAction(form: FormData) {
  const id = Number(form.get("id"));
  await op("campaign.update", { id, archived: form.get("archived") === "1" });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function linkRowAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("id"));
  const r = await op("campaign.link", { id, rows: [filled({ tracker_num: int(form, "tracker_num"), channel: opt(form, "channel") })] });
  if (r.ok) revalidatePath(`/campaigns/${id}`);
  return out(r);
}

export async function unlinkRowAction(form: FormData) {
  const id = Number(form.get("id"));
  await op("campaign.link", { id, rows: [{ tracker_num: Number(form.get("tracker_num")) }], remove: true });
  revalidatePath(`/campaigns/${id}`);
}

/** A deadline, fair day, or slot on a campaign. */
export async function campaignEventAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("id"));
  const r = await op("campaign.schedule", {
    id, ...filled({
      kind: str(form, "kind"), title: str(form, "title"), start: str(form, "start"), end: opt(form, "end"), timezone: opt(form, "timezone"),
      tracker_num: int(form, "tracker_num"), location: opt(form, "location"), round: opt(form, "round"),
    }),
  }, "calendar.added");
  if (r.ok) revalidatePath(`/campaigns/${id}`);
  return out(r);
}

// ---------------------------------------------------------------- calendar

export async function eventAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("event.create", filled({
    kind: str(form, "kind"), title: str(form, "title"), start: str(form, "start"), end: opt(form, "end"), timezone: opt(form, "timezone"),
    tracker_num: int(form, "tracker_num"), location: opt(form, "location"), meeting_url: opt(form, "meeting_url"), note: opt(form, "note"),
  }), "calendar.added");
  if (r.ok) revalidatePath("/", "layout");
  return out(r);
}

/** Done, not done, or cancelled. `back` is the page to refresh. */
export async function eventStateAction(form: FormData) {
  const change = str(form, "change");
  await op("event.update", { id: Number(form.get("id")), ...(change === "cancel" ? { cancelled: true } : { done: change === "done" }) });
  revalidatePath(str(form, "back") || "/calendar");
}

// ---------------------------------------------------------------- agents and tokens

export async function createAgentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("agent.create", { name: str(form, "name"), can_see_comp: form.get("comp") === "on", can_see_contacts: form.get("contacts") === "on" });
  if (r.ok) revalidatePath("/settings/agents");
  return out(r);
}

export async function disableAgentAction(form: FormData) {
  await op("agent.disable", { id: Number(form.get("id")) });
  revalidatePath("/settings/agents");
}

/** A key for an agent, a calendar feed, or the browser extension (capture). The raw token comes back once, in `data`. */
export async function tokenAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("token.create", { user_id: Number(form.get("user_id")), kind: str(form, "kind"), name: str(form, "name") || str(form, "kind") });
  if (r.ok) { revalidatePath("/settings/agents"); revalidatePath("/calendar"); revalidatePath("/people"); }
  return out({ ...r, data: (r.data as { token?: string } | undefined)?.token });
}

export async function revokeTokenAction(form: FormData) {
  await op("token.revoke", { id: Number(form.get("id")) });
  revalidatePath(str(form, "back") || "/settings/agents");
}

// ---------------------------------------------------------------- capture

export async function captureAction(input: { url: string; title: string; text: string; selection: string; company: string; role: string; location: string; note: string }): Promise<ActionResult> {
  const r = await op("posting.capture", { ...input, via: "bookmarklet" });
  if (r.ok) revalidatePath("/applications");
  return out(r);
}

// ---------------------------------------------------------------- inbox

const SIGNAL_OPS = new Set(["tracker.setStatus", "event.create", "posting.add", "posting.capture"]);

/**
 * Do what a signal proposes, then close it. The action is read back from the
 * signal on the server (never taken from the form), limited to the four
 * operations a signal may propose, and run as the signed-in person.
 */
export async function signalAction(form: FormData) {
  const id = Number(form.get("id"));
  const i = Number(form.get("action"));
  const got = await op("inbox.get", { id });
  const action = (got.data as { signal?: { proposed?: { actions?: { op: string; input: Record<string, unknown> }[] } } } | undefined)?.signal?.proposed?.actions?.[i];
  let error = got.ok ? "" : got.error || "";
  if (action && SIGNAL_OPS.has(action.op)) {
    const r = await op(action.op, action.input);
    if (r.ok) await op("signal.update", { id, status: action.op.startsWith("posting.") ? "filed" : "acted", note: `${action.op} from the inbox` });
    else error = r.error || "";
  }
  revalidatePath("/", "layout");
  redirect(`/inbox${error ? `?error=${encodeURIComponent(error)}` : "?done=1"}`);
}

export async function dismissSignalAction(form: FormData) {
  await op("signal.update", { id: Number(form.get("id")), status: "dismissed" });
  revalidatePath("/inbox");
}
