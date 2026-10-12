"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { engine } from "@/lib/server/engine";
import { LANG_COOKIE, clientIp, getLang, getUser, requireUser, startSession, stopSession } from "@/lib/server/session";
import { errorText } from "@/lib/server/errors";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

const safeNext = (next: unknown) => (typeof next === "string" && /^\/(?!\/)[\w\-/?=&%.#:]*$/.test(next) ? next : "/today");

export async function signInAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { t } = translator(await getLang());
  let user;
  const { root, people } = await engine();
  try {
    user = people.signIn(root, { login: String(form.get("login") || "").trim(), password: String(form.get("password") || ""), ip: await clientIp() });
  } catch (e) {
    return { ok: false, error: errorText(e, t, await getLang()) };
  }
  await startSession(user, "password");
  redirect(safeNext(form.get("next")));
}

export async function signOutAction() {
  await stopSession();
  redirect("/login");
}

export async function acceptInviteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const lang = await getLang();
  const { t } = translator(lang);
  let user;
  const { root, people } = await engine();
  try {
    user = people.acceptInvite(root, String(form.get("token") || ""), {
      login: String(form.get("login") || "").trim(), password: String(form.get("password") || ""),
      name: String(form.get("name") || "").trim() || null, lang: form.get("lang") === "ja" ? "ja" : form.get("lang") === "en" ? "en" : null,
    });
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang) };
  }
  await startSession(user, "invite");
  redirect("/today?welcome=1");
}

/** Language for a guest is a cookie; for a signed-in person it's their setting. */
export async function setLangAction(form: FormData) {
  const lang = form.get("lang") === "ja" ? "ja" : "en";
  const user = await getUser();
  if (user) { const { root, people } = await engine(); people.updateUser(root, { actor: user, id: user.id, changes: { lang } }); }
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Back to the same page: the form says where, else the referring page on this site.
  let back = form.get("back");
  if (!back) {
    try { const ref = new URL((await headers()).get("referer") || ""); back = `${ref.pathname}${ref.search}`; } catch {}
  }
  redirect(safeNext(back));
}

// ---------------------------------------------------------------- passkeys

export async function passkeyLoginOptions() {
  const { root, passkeys } = await engine();
  return passkeys.authenticationOptions(root);
}

export async function passkeyLoginVerify(response: unknown, next: string): Promise<ActionResult> {
  const lang = await getLang();
  const { t } = translator(lang);
  try {
    const { root, passkeys } = await engine();
    const user = await passkeys.finishAuthentication(root, response);
    await startSession(user, "passkey");
    return { ok: true, data: safeNext(next) };
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang) };
  }
}

export async function passkeyRegisterOptions() {
  const user = await requireUser();
  const { root, passkeys } = await engine();
  return passkeys.registrationOptions(root, user);
}

export async function passkeyRegisterVerify(response: unknown, name: string): Promise<ActionResult> {
  const user = await requireUser();
  const lang = await getLang();
  const { t } = translator(lang);
  try {
    const { root, passkeys } = await engine();
    await passkeys.finishRegistration(root, user, response, name);
    return { ok: true, message: t("settings.passkeyAdded") };
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang) };
  }
}
