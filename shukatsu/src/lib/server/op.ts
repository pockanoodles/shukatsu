import "server-only";
import { engine } from "./engine";
import { getLang, requireUser, type User } from "./session";
import { errorText } from "./errors";
import { translator } from "@/lib/i18n";
import type { ActionResult } from "@/lib/types";

/**
 * Run one operation as the signed-in person: the app's only way to change
 * anything. The registry checks the permission and the stamp rule, validates
 * the input, and logs the activity, exactly as it does for an agent.
 * `ok` is the i18n key of the success message.
 */
export async function op(name: string, input: Record<string, unknown>, ok?: string): Promise<ActionResult & { user: User }> {
  const user = await requireUser();
  const lang = await getLang();
  const { t } = translator(lang);
  try {
    const { root, ops } = await engine();
    // A result can hold SQLite rows (null-prototype objects), which React won't pass to a client component: send plain JSON.
    const data = JSON.parse(JSON.stringify((await ops.run(root, ops.sessionPrincipal(user), name, input)) ?? null));
    return { ok: true, message: ok ? t(ok) : undefined, data, user };
  } catch (e) {
    return { ok: false, error: errorText(e, t, lang), user };
  }
}

/** Run a query as the signed-in person for a page; throws on refusal so the page's error boundary shows it. */
export async function read<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const user = await requireUser();
  const { root, ops } = await engine();
  return ops.run(root, ops.sessionPrincipal(user), name, input) as Promise<T>;
}

/** The part of a result a client component gets (never the user row). */
export const out = ({ user: _user, ...r }: ActionResult & { user?: User }): ActionResult => r;
