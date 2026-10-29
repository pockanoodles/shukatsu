"use server";

/**
 * Every change the app makes, outside sign-in. Each action is one call to the
 * operations registry (core/ops) as the signed-in person, which checks the
 * permission and the stamp rule, validates the input, and logs the activity,
 * exactly as it does for an agent over MCP. None of them sends anything anywhere.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engine } from "@/lib/server/engine";
import { getLang, requireUser } from "@/lib/server/session";
import { op, out } from "@/lib/server/op";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const num = (form: FormData, k: string) => Number(form.get(k));

// ---------------------------------------------------------------- live lint

export async function lintAction(text: string, original: string | null, current: boolean) {
  await requireUser();
  const { root, validate, facts } = await engine();
  const findings = validate.lintWording(root, text, { current });
  const diff = original ? facts.numberDiff(original, text) : { added: [], removed: [] };
  return { findings, chars: [...text].length, max: 230, added: diff.added, removed: diff.removed };
}

// ---------------------------------------------------------------- review

export async function decideAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const key = str(form, "key");
  const outcome = str(form, "outcome");
  const r = await op("review.decide", { key, outcome, ...(form.has("text") ? { text: str(form, "text") } : {}), reason: str(form, "reason") });
  if (!r.ok) return out(r);
  revalidatePath("/", "layout");
  const next = str(form, "next");
  redirect(`/review?${next ? `item=${encodeURIComponent(next)}&` : ""}done=${encodeURIComponent(outcome)}&stamped=${encodeURIComponent(key)}`);
}

export async function reopenAction(form: FormData) {
  const key = str(form, "key");
  const r = await op("review.reopen", { key });
  revalidatePath("/", "layout");
  redirect(r.ok ? `/review?item=${encodeURIComponent(key)}` : `/review/decided?error=${encodeURIComponent(r.error || "")}`);
}

export async function commentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("comment.add", { subject: str(form, "subject"), body: str(form, "body"), ...(num(form, "parent") ? { parent: num(form, "parent") } : {}) });
  if (r.ok) revalidatePath(str(form, "path") || "/review");
  return out(r);
}

export async function resolveCommentAction(form: FormData) {
  await op("comment.resolve", { id: num(form, "id") });
  revalidatePath(str(form, "path") || "/review");
}

// ---------------------------------------------------------------- record

/**
 * A change to the record. A mentor's becomes a proposal; the candidate's own
 * goes through the same proposal and is stamped at once, so both share one
 * history.
 */
export async function recordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const kind = str(form, "kind");
  const payload: Record<string, unknown> = {};
  for (const k of ["id", "part", "text", "entity", "priority", "ja", "reason", "section", "label", "heading", "title", "dates"]) if (form.has(k)) payload[k] = str(form, k);
  // Tags arrive as one checkbox value each.
  if (form.has("tags")) payload.tags = form.getAll("tags").map(String).filter(Boolean);
  if (form.has("ended")) payload.ended = form.get("ended") === "on" || form.get("ended") === "true";
  else if (kind === "entity.new") payload.ended = false;
  const r = await op("profile.propose", { kind, payload, note: str(form, "note") });
  if (!r.ok) return out(r);
  const { t } = translator(await getLang());
  if (r.user.role === "owner") {
    const stamped = await op("review.decide", { key: (r.data as { review_key: string }).review_key, outcome: "accept" });
    if (!stamped.ok) return out(stamped);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: r.user.role === "owner" ? t("record.savedDirect") : t("record.proposed") };
}

export async function withdrawProposalAction(form: FormData) {
  await op("proposal.update", { id: num(form, "id"), withdraw: true });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- applications

export async function postingAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("posting.add", { url: str(form, "url"), company: str(form, "company"), role: str(form, "role"), note: str(form, "note") });
  if (!r.ok) return out(r);
  const { t } = translator(await getLang());
  const filed = (r.data as { filed: string }).filed;
  revalidatePath("/", "layout");
  return { ok: true, message: t(filed === "duplicate" ? "apps.duplicate" : filed === "pipeline" ? "apps.added" : "apps.suggested") };
}

export async function statusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("tracker.setStatus", { num: num(form, "num"), state: str(form, "state"), note: str(form, "note") }, "apps.statusSaved");
  if (r.ok) revalidatePath("/applications");
  return out(r);
}

// ---------------------------------------------------------------- packets

export async function createPacketAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("packet.create", {
    company: str(form, "company"), role: str(form, "role"), url: str(form, "url"),
    jd_text: String(form.get("jd") || ""), archetype: str(form, "archetype"), lang: str(form, "lang") || "en",
  });
  if (!r.ok) return out(r);
  revalidatePath("/packets");
  redirect(`/packets/${(r.data as { id: number }).id}`);
}

const packetPath = (id: number) => `/packets/${id}`;

export async function bulletAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = num(form, "packet");
  const r = await op("packet.edit", { id, bullets: [{ fact: str(form, "fact"), text: str(form, "text") }] }, "common.saved");
  if (r.ok) revalidatePath(packetPath(id));
  return out(r);
}

export async function selectionAction(form: FormData) {
  const id = num(form, "packet");
  const r = await op("packet.select", { id, fact: str(form, "fact"), action: str(form, "action") });
  revalidatePath(packetPath(id));
  if (!r.ok) redirect(`${packetPath(id)}?error=${encodeURIComponent(r.error || "")}`);
}

export async function checkPacketAction(form: FormData) {
  const id = num(form, "packet");
  const r = await op("packet.check", { id });
  revalidatePath(packetPath(id));
  redirect(`${packetPath(id)}?checked=1${r.ok ? "" : `&error=${encodeURIComponent(r.error || "")}`}#check`);
}

export async function coverAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = num(form, "packet");
  const r = await op("packet.edit", {
    id, ...(form.has("cover") ? { cover: String(form.get("cover")) } : {}), ...(form.has("notes") ? { notes: String(form.get("notes")) } : {}),
  }, "common.saved");
  if (r.ok) revalidatePath(packetPath(id));
  return out(r);
}

export async function candidateJaAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("candidate.setJa", { name: str(form, "name"), location: str(form, "location"), availability: str(form, "availability") }, "common.saved");
  if (r.ok) revalidatePath("/", "layout");
  return out(r);
}

export async function answersAction(packetId: number, answers: { id?: string; question: string; limit: number | null; unit: string; text: string }[]): Promise<ActionResult> {
  const r = await op("packet.edit", { id: packetId, answers }, "common.saved");
  if (r.ok) revalidatePath(packetPath(packetId));
  return out(r);
}

const STEPS: Record<string, (id: number, form: FormData) => [string, Record<string, unknown>]> = {
  requestReview: (id) => ["packet.requestReview", { id }],
  withdraw: (id) => ["packet.requestReview", { id, withdraw: true }],
  ready: (id) => ["packet.ready", { id }],
  sent: (id, form) => ["packet.markSent", { id, ...(str(form, "on") ? { on: str(form, "on") } : {}) }],
  close: (id) => ["packet.close", { id }],
};

export async function packetStepAction(form: FormData) {
  const id = num(form, "packet");
  const step = str(form, "step");
  const r = STEPS[step] ? await op(...STEPS[step](id, form)) : { ok: false, error: "Unknown step." };
  revalidatePath("/", "layout");
  redirect(`${packetPath(id)}?${r.ok ? `done=${step}` : `error=${encodeURIComponent(r.error || "")}`}`);
}

export async function suggestAction(packetId: number, factId: string): Promise<ActionResult> {
  return out(await op("packet.suggest", { id: packetId, fact: factId }));
}

// ---------------------------------------------------------------- people

export async function inviteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("people.invite", { role: str(form, "role"), name: str(form, "name"), ...(str(form, "relation") ? { relation: str(form, "relation") } : {}), lang: str(form, "lang") === "ja" ? "ja" : "en" });
  if (r.ok) revalidatePath("/people");
  return out(r);
}

export async function resetLinkAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await op("people.reset", { id: num(form, "id") });
  if (r.ok) revalidatePath("/people");
  return out({ ...r, data: (r.data as { token?: string } | undefined)?.token });
}

export async function personAction(form: FormData) {
  const id = num(form, "id");
  const change = str(form, "op");
  const r =
    change === "disable" ? await op("people.disable", { id })
    : change === "enable" ? await op("people.disable", { id, enable: true })
    : change === "revoke" ? await op("invite.revoke", { id })
    : change === "update" ? await op("people.update", { id, ...(form.has("role") ? { role: str(form, "role") } : {}), can_see_comp: form.get("can_see_comp") === "on" })
    : { ok: false, error: "Unknown change." };
  revalidatePath("/people");
  if (!r.ok) redirect(`/people?error=${encodeURIComponent(r.error || "")}`);
}

// ---------------------------------------------------------------- settings

export async function accountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const r = await op("account.update", { name: str(form, "name") || user.name, email: str(form, "email") || null, lang: str(form, "lang") === "ja" ? "ja" : "en" }, "common.saved");
  if (r.ok) revalidatePath("/", "layout");
  return out(r);
}

export async function passwordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return out(await op("account.password", { current: String(form.get("current") || ""), password: String(form.get("password") || "") }, "settings.passwordChanged"));
}

export async function removePasskeyAction(form: FormData) {
  await op("passkey.remove", { id: str(form, "id") });
  revalidatePath("/settings");
}

export async function endSessionAction(form: FormData) {
  await op("session.end", { hash: str(form, "hash") });
  revalidatePath("/settings");
}

export async function seenAction() {
  await op("activity.seen", {});
}
