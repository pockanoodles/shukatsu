import type { Metadata } from "next";
import { headers } from "next/headers";
import { engine } from "@/lib/server/engine";
import { requireCan } from "@/lib/server/session";
import { formatDate, relative, translator } from "@/lib/i18n";
import { errorText } from "@/lib/server/errors";
import { Flash, Head } from "@/components/marks";
import { ConfirmSubmit } from "@/components/client";
import { personAction } from "@/app/actions/work";
import { InviteForm, ResetLink } from "./forms";
import { ActionForm } from "@/components/system-forms";
import { tokenAction } from "@/app/actions/system";

export const metadata: Metadata = { title: "People" };

type Person = { id: number; login: string; name: string; relation: string | null; role: string; lang: string; can_see_comp: number; last_seen_at: string | null; disabled_at: string | null; passkeys: number; has_password: number };
type Invite = { id: number; user_id: number | null; role: string; name: string; relation: string | null; expires_at: string; created_at: string };

/** The address invite links point at: the configured URL, else the one this page was opened on. */
async function baseUrl() {
  if (process.env.SHUKATSU_URL) return process.env.SHUKATSU_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") || "http"}://${h.get("x-forwarded-host") || h.get("host")}`;
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCan("people.manage");
  const { t } = translator(user.lang);
  const sp = await searchParams;
  const { root, people } = await engine();
  const list: Person[] = people.listUsers(root);
  const invites: Invite[] = people.openInvites(root);
  const base = await baseUrl();
  const l: Record<string, string> = {
    name: t("people.name"), relation: t("people.relation"), relationHelp: t("people.relationHelp"), role: t("people.role"), language: t("people.language"),
    create: t("people.create"), working: t("common.loading"), linkReady: t("people.linkReady"), copyLink: t("people.copyLink"),
    copied: t("common.copied"), resetLink: t("people.resetLink"), resetReady: t("people.resetReady"),
  };
  const roles = ["editor", "reviewer", "viewer"].map((r) => ({ id: r, label: t(`role.${r}`), help: t(`role.${r}Help`) }));
  return (
    <div>
      {sp.error && <Flash tone="shu">{errorText(new Error(sp.error), t, user.lang)}</Flash>}
      <Head title={t("people.title")} lead={t("people.lead")} />
      <section className="grid border-b-2 rule lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="border-b-2 rule lg:border-b-0 lg:border-r-2">
          <h2 className="label border-b-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("people.list")} · {list.filter((p) => !p.disabled_at).length}</h2>
          <ul>
            {list.map((p) => (
              <li key={p.id} className={`grid gap-3 border-b hair px-4 py-5 sm:px-10 ${p.disabled_at ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="heading text-[20px]">{p.name}</span>
                    {p.relation && <span className="text-ink-2">{p.relation}</span>}
                  </div>
                  <span className={`label ${p.disabled_at ? "text-shu" : ""}`}>{p.disabled_at ? t("people.disabled") : t(`role.${p.role}`)}</span>
                </div>
                <p className="label text-ink-3">{p.login} · {p.lang === "ja" ? "日本語" : "English"} · {t("people.lastSeen", { when: p.last_seen_at ? relative(p.last_seen_at, user.lang) : t("people.never") })} · {t("people.passkeys", { n: p.passkeys })}</p>
                {p.role !== "owner" && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <form action={personAction} className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="update" />
                      <label className="sr-only" htmlFor={`role-${p.id}`}>{t("people.role")}</label>
                      <select id={`role-${p.id}`} name="role" defaultValue={p.role} className="field min-h-9 w-auto py-1 pr-8 text-[13px]">
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                      <label className="flex min-h-9 items-center gap-2 text-[13.5px]"><input type="checkbox" name="can_see_comp" defaultChecked={Boolean(p.can_see_comp)} className="h-4 w-4 accent-[var(--ink)]" />{t("people.comp")}</label>
                      <button className="btn btn-ghost btn-sm">{t("common.save")}</button>
                    </form>
                    <ResetLink id={p.id} name={p.name} base={base} l={l} />
                    {!p.disabled_at && (
                      <ActionForm action={tokenAction} submit={t("sys.familyFeed")} pending={t("common.loading")} buttonClass="btn btn-ghost btn-sm" className="flex"
                        secret={{ lead: t("sys.familyFeedMade", { name: p.name }), copy: t("common.copy"), copied: t("common.copied"), template: `${base}/cal/{token}.ics` }}>
                        <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="kind" value="feed" /><input type="hidden" name="name" value={`${p.name}'s calendar`} />
                      </ActionForm>
                    )}
                    <form action={personAction}>
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value={p.disabled_at ? "enable" : "disable"} />
                      {p.disabled_at ? <button className="label text-ink-2 underline underline-offset-4">{t("people.enable")}</button>
                        : <ConfirmSubmit message={t("people.disableConfirm", { name: p.name })} className="label text-shu underline underline-offset-4">{t("people.disable")}</ConfirmSubmit>}
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {invites.length > 0 && (
            <>
              <h2 className="label border-y-2 rule bg-paper-2 px-4 py-2.5 text-ink-2 sm:px-10">{t("people.pending")} · {invites.length}</h2>
              <ul>
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b hair px-4 py-3 sm:px-10">
                    <span>{i.name} <span className="label ml-2 text-ink-3">{t(`role.${i.role}`)} · {formatDate(i.expires_at, user.lang)}</span></span>
                    <form action={personAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="revoke" /><button className="label text-ink-2 underline underline-offset-4">{t("people.revoke")}</button></form>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="px-4 py-6 sm:px-8">
          <h2 className="heading mb-5 text-[24px]">{t("people.invite")}</h2>
          <InviteForm base={base} roles={roles} l={l} />
        </div>
      </section>
    </div>
  );
}
