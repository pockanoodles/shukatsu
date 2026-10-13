"use server";

/**
 * Consent for a client that asked to use shukatsu over OAuth. Granting is a
 * stamp: only the owner, signed in by session within the last ten minutes,
 * and only by choosing which agent identity the client receives. Nothing here
 * issues a token. It records a one-time code bound to that identity and sends
 * the browser back to the client, which trades the code for a token itself.
 */

import { redirect } from "next/navigation";
import { engine } from "@/lib/server/engine";
import { getUser, stopSession } from "@/lib/server/session";
import { loadOAuth } from "@/app/oauth/_oauth";

const consentUrl = (request: string, error?: string) => `/oauth/consent?request=${encodeURIComponent(request)}${error ? `&error=${error}` : ""}`;
const requestOf = (form: FormData) => String(form.get("request") ?? "");

export async function approveOAuthAction(form: FormData) {
  const request = requestOf(form);
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(consentUrl(request))}`);
  const { root, ops } = await engine();
  const oauth = await loadOAuth();

  let agentId = Number(form.get("agent"));
  if (form.get("agent") === "new") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) redirect(consentUrl(request, "name"));
    try {
      agentId = (await ops.run(root, ops.sessionPrincipal(user), "agent.create", { name })).id;
    } catch {
      redirect(consentUrl(request, "name"));
    }
  }

  let to: string;
  try {
    to = oauth.grant(root, { owner: user, requestId: request, agentId }).redirect;
  } catch (e) {
    const code = (e as { error?: string })?.error;
    redirect(consentUrl(request, code === "login_required" ? "stale" : code === "access_denied" ? "owner" : "expired"));
  }
  redirect(to);
}

export async function denyOAuthAction(form: FormData) {
  const request = requestOf(form);
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(consentUrl(request))}`);
  const { root } = await engine();
  const oauth = await loadOAuth();
  let to: string;
  try {
    to = oauth.deny(root, { requestId: request }).redirect;
  } catch {
    redirect(consentUrl(request, "expired"));
  }
  redirect(to);
}

/** A stale sign-in can't give access: end the session and sign in fresh, then come back to the same request. */
export async function reauthenticateAction(form: FormData) {
  const request = requestOf(form);
  await stopSession();
  redirect(`/login?next=${encodeURIComponent(consentUrl(request))}`);
}
