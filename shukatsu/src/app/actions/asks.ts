"use server";

/**
 * Asks (core/asks.mjs): the candidate asking one person to look at one item,
 * and that person answering. Each action is one call to the operations
 * registry as the signed-in person. None of them sends anything: the person
 * hears about an ask from the daemon's minute tick (connectors/line).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { op } from "@/lib/server/op";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const num = (form: FormData, k: string) => Number(form.get(k));
// Back to the page the form was on; only a path on this site.
const back = (form: FormData) => { const p = str(form, "path"); return p.startsWith("/") && !p.startsWith("//") ? p.split("?")[0] : "/today"; };
const withQuery = (path: string, q: string) => { const [p, hash] = path.split("#"); return `${p}?${q}${hash ? `#${hash}` : ""}`; };

export async function askAction(form: FormData) {
  const r = await op("ask.create", { to: num(form, "to"), subject: str(form, "subject"), note: str(form, "note") });
  revalidatePath("/", "layout");
  redirect(withQuery(back(form), r.ok ? "asked=1" : `error=${encodeURIComponent(r.error || "")}`));
}

export async function replyAskAction(form: FormData) {
  const id = num(form, "id");
  const fine = str(form, "fine") === "1";
  // The text goes as typed: the engine trims it, and a written answer keeps its line breaks.
  const r = await op("ask.reply", { id, text: String(form.get("text") ?? ""), note: str(form, "note"), fine });
  revalidatePath("/", "layout");
  redirect(`/ask/${id}?${r.ok ? "replied=1" : `error=${encodeURIComponent(r.error || "")}`}`);
}

export async function closeAskAction(form: FormData) {
  const id = num(form, "id");
  const outcome = str(form, "outcome");
  const r = await op("ask.close", { id, outcome, note: str(form, "note") });
  revalidatePath("/", "layout");
  redirect(`/ask/${id}?${r.ok ? "closed=1" : `error=${encodeURIComponent(r.error || "")}`}`);
}

export async function cancelAskAction(form: FormData) {
  const id = num(form, "id");
  const r = await op("ask.cancel", { id });
  revalidatePath("/", "layout");
  redirect(`/ask/${id}?${r.ok ? "cancelled=1" : `error=${encodeURIComponent(r.error || "")}`}`);
}
