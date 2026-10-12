"use server";

/**
 * Every mutation the app makes, outside sign-in. Each one resolves the person,
 * hands the engine their identity (which enforces the permission), and
 * revalidates what changed. None of them sends anything anywhere.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engine, type Engine } from "@/lib/server/engine";
import { getLang, requireUser } from "@/lib/server/session";
import { errorText } from "@/lib/server/errors";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

async function run(fn: (root: string, user: Awaited<ReturnType<typeof requireUser>>, e: Engine) => unknown, ok?: string): Promise<ActionResult> {
  const user = await requireUser();
  const lang = await getLang();
  const { t } = translator(lang);
  try {
    const e = await engine();
    const data = await fn(e.root, user, e);
    return { ok: true, message: ok ? t(ok) : undefined, data };
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang) };
  }
}

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
  const r = await run((root, user, e) => e.review.decide(root, {
    actor: user, key, outcome, text: form.has("text") ? str(form, "text") : null, reason: str(form, "reason"),
  }));
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  const next = str(form, "next");
  redirect(`/review?${next ? `item=${encodeURIComponent(next)}&` : ""}done=${encodeURIComponent(outcome)}&stamped=${encodeURIComponent(key)}`);
}

export async function reopenAction(form: FormData) {
  const key = str(form, "key");
  const r = await run((root, user, e) => e.review.reopen(root, { actor: user, key }));
  revalidatePath("/", "layout");
  redirect(r.ok ? `/review?item=${encodeURIComponent(key)}` : `/review/decided?error=${encodeURIComponent(r.error || "")}`);
}

export async function commentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => e.store.addComment(root, { actor: user, subject: str(form, "subject"), body: str(form, "body") }));
  if (r.ok) revalidatePath(str(form, "path") || "/review");
  return r;
}

export async function resolveCommentAction(form: FormData) {
  await run((root, user, e) => e.store.resolveComment(root, { actor: user, id: Number(form.get("id")) }));
  revalidatePath(str(form, "path") || "/review");
}

// ---------------------------------------------------------------- record

/**
 * A change to the record. A mentor's becomes a proposal; the candidate's own
 * goes through the same proposal and is accepted at once, so both share one
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
  const r = await run((root, user, e) => {
    const id = e.proposals.propose(root, { actor: user, kind, payload, note: str(form, "note") });
    if (user.role === "owner") return e.review.decide(root, { actor: user, key: `proposal:${id}`, outcome: "accept" });
    return id;
  }, undefined);
  if (!r.ok) return r;
  const { t } = translator(await getLang());
  revalidatePath("/", "layout");
  const user = await requireUser();
  return { ok: true, message: user.role === "owner" ? t("record.savedDirect") : t("record.proposed") };
}

export async function withdrawProposalAction(form: FormData) {
  await run((root, user, e) => e.proposals.withdraw(root, { actor: user, id: Number(form.get("id")) }));
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- applications

export async function postingAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const payload = { url: str(form, "url"), company: str(form, "company"), role: str(form, "role"), note: str(form, "note") };
  const r = await run((root, _user, e) => {
    const id = e.proposals.propose(root, { actor: user, kind: "posting", payload });
    if (user.role === "owner") e.review.decide(root, { actor: user, key: `proposal:${id}`, outcome: "accept" });
    return id;
  }, user.role === "owner" ? "apps.added" : "apps.suggested");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function statusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => {
    e.people.assertCan(user, "e.tracker.write");
    const res = e.tracker.setStatus(root, Number(form.get("num")), str(form, "state"), str(form, "note"));
    if (!res.ok) throw new Error(res.out.split("\n").slice(-3).join(" "));
    e.store.logActivity(root, { actor: user, verb: "e.tracker.status", subject: `app:${form.get("num")}`, detail: { to: str(form, "state") } });
  }, "apps.statusSaved");
  if (r.ok) revalidatePath("/applications");
  return r;
}

// ---------------------------------------------------------------- packets

export async function createPacketAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => e.packets.createPacket(root, {
    actor: user, company: str(form, "company"), role: str(form, "role"), url: str(form, "url"),
    jdText: String(form.get("jd") || ""), archetype: str(form, "archetype"), lang: str(form, "lang") || "en",
  }));
  if (!r.ok) return r;
  revalidatePath("/packets");
  redirect(`/packets/${r.data}`);
}

const packetPath = (id: number) => `/packets/${id}`;

export async function bulletAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("packet"));
  const r = await run((root, user, e) => e.packets.setBullet(root, { actor: user, id, factId: str(form, "fact"), text: str(form, "text") }), "common.saved");
  if (r.ok) revalidatePath(packetPath(id));
  return r;
}

export async function selectionAction(form: FormData) {
  const id = Number(form.get("packet"));
  const r = await run((root, user, e) => e.packets.changeSelection(root, { actor: user, id, factId: str(form, "fact"), action: str(form, "action") }));
  revalidatePath(packetPath(id));
  if (!r.ok) redirect(`${packetPath(id)}?error=${encodeURIComponent(r.error || "")}`);
}

export async function checkPacketAction(form: FormData) {
  const id = Number(form.get("packet"));
  const r = await run((root, user, e) => e.packets.checkPacket(root, { actor: user, id }));
  revalidatePath(packetPath(id));
  redirect(`${packetPath(id)}?checked=1${r.ok ? "" : `&error=${encodeURIComponent(r.error || "")}`}#check`);
}

export async function coverAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("packet"));
  const r = await run((root, user, e) => e.packets.setCover(root, {
    actor: user, id, text: form.has("cover") ? String(form.get("cover")) : undefined, notes: form.has("notes") ? String(form.get("notes")) : undefined,
  }), "common.saved");
  if (r.ok) revalidatePath(packetPath(id));
  return r;
}

export async function candidateJaAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => e.candidate.setCandidateJa(root, { actor: user, values: { name: str(form, "name"), location: str(form, "location"), availability: str(form, "availability") } }), "common.saved");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function answersAction(packetId: number, answers: { question: string; limit: number | null; unit: string; text: string }[]): Promise<ActionResult> {
  const r = await run((root, user, e) => e.packets.setAnswers(root, { actor: user, id: packetId, answers }), "common.saved");
  if (r.ok) revalidatePath(packetPath(packetId));
  return r;
}

export async function packetStepAction(form: FormData) {
  const id = Number(form.get("packet"));
  const step = str(form, "step");
  const r = await run((root, user, e) => {
    if (step === "submit") return e.packets.submitForReview(root, { actor: user, id });
    if (step === "withdraw") return e.packets.withdrawReview(root, { actor: user, id });
    if (step === "ready") return e.packets.markReady(root, { actor: user, id });
    if (step === "sent") return e.packets.markSent(root, { actor: user, id, on: str(form, "on") || undefined });
    if (step === "close") return e.packets.closePacket(root, { actor: user, id });
    throw new Error("Unknown step.");
  });
  revalidatePath("/", "layout");
  redirect(`${packetPath(id)}?${r.ok ? `done=${step}` : `error=${encodeURIComponent(r.error || "")}`}`);
}

export async function suggestAction(packetId: number, factId: string): Promise<ActionResult> {
  return run(async (root, user, e) => {
    const pk = e.packets.getPacketRow(root, packetId);
    if (!pk) throw new Error("No such packet.");
    const p = e.facts.loadProfile(root);
    const hit = p._facts.get(factId);
    if (!hit) throw new Error("No such fact.");
    const full = e.packets.getPacket(root, packetId, user);
    return e.llm.suggestRewordings(root, { actor: user, fact: hit.fact, entity: hit.entity, jdText: full.jdText, current: hit.entity?.ended === false });
  });
}

// ---------------------------------------------------------------- people

export async function inviteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => ({
    token: e.people.createInvite(root, {
      actor: user, role: str(form, "role"), name: str(form, "name"), relation: str(form, "relation") || null, lang: str(form, "lang") === "ja" ? "ja" : "en",
    }),
    name: str(form, "name"),
  }));
  if (r.ok) revalidatePath("/people");
  return r;
}

export async function resetLinkAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => {
    const target = e.people.getUser(root, Number(form.get("id")));
    return e.people.createInvite(root, { actor: user, role: target.role, name: target.name, userId: target.id, days: 2 });
  });
  if (r.ok) revalidatePath("/people");
  return r;
}

export async function personAction(form: FormData) {
  const id = Number(form.get("id"));
  const op = str(form, "op");
  await run((root, user, e) => {
    if (op === "disable") return e.people.disableUser(root, { actor: user, id });
    if (op === "enable") return e.people.enableUser(root, { actor: user, id });
    if (op === "revoke") return e.people.revokeInvite(root, { actor: user, id });
    if (op === "update") {
      const changes: Record<string, unknown> = {};
      if (form.has("role")) changes.role = str(form, "role");
      changes.can_see_comp = form.get("can_see_comp") === "on";
      return e.people.updateUser(root, { actor: user, id, changes });
    }
    throw new Error("Unknown change.");
  });
  revalidatePath("/people");
}

// ---------------------------------------------------------------- settings

export async function accountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run((root, user, e) => e.people.updateUser(root, {
    actor: user, id: user.id, changes: { name: str(form, "name") || user.name, email: str(form, "email") || null, lang: str(form, "lang") === "ja" ? "ja" : "en" },
  }), "common.saved");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function passwordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const lang = await getLang();
  const { t } = translator(lang);
  try {
    const { root, people } = await engine();
    if (!people.verifyPassword(root, user.id, String(form.get("current") || ""))) return { ok: false, error: t("settings.wrongPassword") };
    people.setPassword(root, { actor: user, id: user.id, password: String(form.get("password") || "") });
    return { ok: true, message: t("settings.passwordChanged") };
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang) };
  }
}

export async function removePasskeyAction(form: FormData) {
  await run((root, user, e) => e.passkeys.removePasskey(root, { actor: user, id: str(form, "id") }));
  revalidatePath("/settings");
}

export async function endSessionAction(form: FormData) {
  await run((root, user, e) => e.people.endSessionByHash(root, { actor: user, hash: str(form, "hash") }));
  revalidatePath("/settings");
}

export async function seenAction() {
  const user = await requireUser();
  const { root, store } = await engine();
  const top = store.recentActivity(root, { limit: 1 })[0];
  if (top) store.db(root).prepare("UPDATE users SET seen_activity_id = ? WHERE id = ?").run(top.id, user.id);
}
