"use server";

/**
 * Actions for the Form answers page. Stating an answer is the answers.set
 * stamp, as the signed-in candidate; a suggestion from a fill is accepted
 * through the same call, or dismissed.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { op, out } from "@/lib/server/op";
import type { ActionResult } from "@/lib/types";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

function target(form: FormData) {
  const question = str(form, "question");
  if (question) return { question };
  const country = str(form, "country");
  return { key: str(form, "key"), ...(country ? { country } : {}) };
}

/** State, change, or clear one answer; with `suggestion`, accept that suggestion as stated (its value as edited). */
export async function setAnswerAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const value = form.get("clear") ? "" : str(form, "value");
  const suggestion = Number(form.get("suggestion")) || undefined;
  const r = await op("answers.set", { target: target(form), value, ...(suggestion ? { suggestion } : {}) }, suggestion ? "answers.accepted" : value ? "answers.saved" : "answers.cleared");
  if (!r.ok) return out(r);
  revalidatePath("/answers");
  // An accepted suggestion leaves the list, so the page itself says it was stated.
  if (suggestion) redirect("/answers?done=accepted");
  return out(r);
}

/** One country's work authorization and sponsorship, in one save. */
export async function setCountryAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const country = str(form, "country");
  let last: ActionResult = { ok: true };
  for (const key of ["auth.work", "auth.sponsorship"]) {
    if (!form.has(key)) continue;
    last = out(await op("answers.set", { target: { key, country }, value: str(form, key) }, "answers.saved"));
    if (!last.ok) return last;
  }
  revalidatePath("/answers");
  return last;
}

export async function dismissSuggestionAction(form: FormData) {
  await op("answers.dismiss", { id: Number(form.get("id")) });
  revalidatePath("/answers");
  redirect("/answers?done=dismissed");
}
