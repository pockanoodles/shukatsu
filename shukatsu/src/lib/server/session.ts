import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { engine } from "./engine";
import type { Lang } from "@/lib/i18n";

export const SESSION_COOKIE = "shk_session";
export const LANG_COOKIE = "shk_lang";

export type Role = "owner" | "editor" | "reviewer" | "viewer";
export type User = {
  id: number;
  login: string;
  name: string;
  email: string | null;
  relation: string | null;
  role: Role;
  lang: Lang;
  can_see_comp: number;
  seen_activity_id: number;
  created_at: string;
  last_seen_at: string | null;
  disabled_at: string | null;
  session: { created_at: string; method: string; hash: string };
  /** What this person may do, decided by the engine when the session is read. */
  perms: Record<string, boolean>;
};

export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { root, people } = await engine();
  const user = people.sessionUser(root, token);
  if (!user) return null;
  const perms = Object.fromEntries((people.PERMISSIONS as string[]).map((a) => [a, Boolean(people.can(user, a))]));
  return { ...user, perms };
});

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCan(action: string): Promise<User> {
  const user = await requireUser();
  if (!user.perms[action]) redirect("/today?denied=1");
  return user;
}

export const allowed = (user: User | null, action: string): boolean => Boolean(user?.perms[action]);

/** The address this request came in on, as the browser sees it. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

// Secure cookies follow the request, not SHUKATSU_URL: with an https
// SHUKATSU_URL, opening http://localhost on the same machine must still sign
// in, and Safari drops a Secure cookie set over plain http.
async function secureCookies(): Promise<boolean> {
  return (await requestOrigin()).startsWith("https://");
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
}

export async function startSession(user: { id: number }, method: "password" | "passkey" | "invite") {
  const h = await headers();
  const { root, people } = await engine();
  const s = people.createSession(root, user, { ip: await clientIp(), userAgent: h.get("user-agent"), method });
  (await cookies()).set(SESSION_COOKIE, s.token, {
    httpOnly: true, sameSite: "lax", secure: await secureCookies(), path: "/", maxAge: s.maxAge,
  });
}

export async function stopSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) { const { root, people } = await engine(); people.endSession(root, token); }
  jar.delete(SESSION_COOKIE);
}

/** Language: the person's setting, else their choice on this browser, else the browser's language. */
export const getLang = cache(async (): Promise<Lang> => {
  const user = await getUser();
  if (user) return user.lang;
  const chosen = (await cookies()).get(LANG_COOKIE)?.value;
  if (chosen === "ja" || chosen === "en") return chosen;
  const accept = (await headers()).get("accept-language") || "";
  return /^ja\b/i.test(accept.trim()) ? "ja" : "en";
});
