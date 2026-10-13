import type { Metadata } from "next";
import { requestOrigin, requireCan } from "@/lib/server/session";
import { read } from "@/lib/server/op";
import { relative, translator } from "@/lib/i18n";
import { Head } from "@/components/marks";
import { ConfirmSubmit, CopyButton } from "@/components/client";
import { ActionForm, Bookmarklet } from "@/components/system-forms";
import { createAgentAction, disableAgentAction, revokeTokenAction, tokenAction } from "@/app/actions/system";

export const metadata: Metadata = { title: "Agents" };

type Agent = { id: number; name: string; login: string; disabled_at: string | null; can_see_comp: number; can_see_contacts: number; last_seen_at: string | null; tokens: number };
type Token = { id: number; user_id: number; kind: string; name: string; prefix: string; client_id: string | null; created_at: string; last_used_at: string | null; expires_at: string | null };

/**
 * The bookmarklet: opens shukatsu's capture window and hands it the page the
 * candidate is reading, retrying until the window says it has it. It carries
 * no token; the window uses the candidate's own session.
 */
const bookmarklet = (base: string) => `javascript:(()=>{const B=${JSON.stringify(base)};const w=window.open(B+'/capture','shukatsu_capture','width=620,height=820');if(!w)return alert('Allow pop-ups to send this page to shukatsu.');const d={type:'shukatsu.capture',url:location.href,title:document.title,text:(document.body.innerText||'').slice(0,400000),selection:String(getSelection()||'').slice(0,200000)};let n=0;const t=setInterval(()=>{try{w.postMessage(d,B)}catch(e){}if(++n>80)clearInterval(t)},250);addEventListener('message',e=>{if(e.origin===B&&e.data==='shukatsu.capture.ok')clearInterval(t)})})()`;

function Snippet({ text, copy, copied }: { text: string; copy: string; copied: string }) {
  return (
    <div className="grid gap-2">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-paper-2 px-3 py-2 font-mono text-[12.5px]">{text}</pre>
      <div><CopyButton text={text} label={copy} done={copied} /></div>
    </div>
  );
}

export default async function AgentsPage() {
  const user = await requireCan("agent.manage");
  const { t } = translator(user.lang);
  const { agents, tokens } = await read<{ agents: Agent[]; tokens: Token[] }>("agent.list");
  const base = (process.env.SHUKATSU_URL || (await requestOrigin())).replace(/\/$/, "");
  const keysFor = (id: number) => tokens.filter((k) => k.user_id === id && (k.kind === "agent" || k.kind === "oauth"));
  const copy = { copy: t("common.copy"), copied: t("common.copied") };
  // An agent signs in by key only, so it was last seen when one of its keys was last used.
  const lastUsed = (id: number) => keysFor(id).map((k) => k.last_used_at).filter(Boolean).sort().pop() || null;

  return (
    <div>
      <Head eyebrow={t("nav.settings")} title={t("agents.title")} lead={t("agents.lead")} />
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="border-b-2 rule lg:border-r-2">
          {agents.length === 0 ? <p className="px-4 py-8 text-ink-3 sm:px-10">{t("agents.none")}</p> : agents.map((a) => (
            <div key={a.id} className={`grid gap-4 border-b-2 rule px-4 py-6 sm:px-10 ${a.disabled_at ? "text-ink-3" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="heading text-[22px]">{a.name}</h2>
                  <p className="label mt-1 text-ink-3">
                    {a.disabled_at ? t("agents.disabled") : lastUsed(a.id) ? t("agents.lastUsed", { when: relative(lastUsed(a.id), user.lang) }) : t("agents.neverUsed")}
                    {a.can_see_comp ? ` · ${t("agents.comp")}` : ""}{a.can_see_contacts ? ` · ${t("agents.contacts")}` : ""}
                  </p>
                </div>
                {!a.disabled_at && (
                  <form action={disableAgentAction}><input type="hidden" name="id" value={a.id} /><ConfirmSubmit message={t("agents.disableConfirm")}>{t("agents.disable")}</ConfirmSubmit></form>
                )}
              </div>
              {keysFor(a.id).length > 0 && (
                <ul className="border-t hair">
                  {keysFor(a.id).map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-4 border-b hair py-2.5">
                      <span className="grid">
                        <span>{k.name} <span className="font-mono text-[12px] text-ink-3">{k.prefix}…</span></span>
                        <span className="label text-ink-3">{k.last_used_at ? t("agents.lastUsed", { when: relative(k.last_used_at, user.lang) }) : t("agents.neverUsed")}</span>
                      </span>
                      <form action={revokeTokenAction}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="back" value="/settings/agents" /><button className="label text-ink-2 underline underline-offset-4">{t("agents.revoke")}</button></form>
                    </li>
                  ))}
                </ul>
              )}
              {!a.disabled_at && (
                <ActionForm action={tokenAction} submit={t("agents.makeKey")} pending={t("common.loading")} buttonClass="btn btn-ghost btn-sm" className="flex flex-wrap items-end gap-3"
                  secret={{ lead: t("agents.keyMade"), ...copy }}>
                  <input type="hidden" name="user_id" value={a.id} /><input type="hidden" name="kind" value="agent" />
                  <label className="grid gap-1.5"><span className="label text-ink-2">{t("agents.keyName")}</span><input name="name" required maxLength={80} placeholder={t("agents.keyPlaceholder")} className="field min-h-9 w-56 py-1" /></label>
                </ActionForm>
              )}
            </div>
          ))}
          <div className="grid gap-4 px-4 py-6 sm:px-10">
            <h2 className="heading text-[20px]">{t("agents.new")}</h2>
            <ActionForm action={createAgentAction} submit={t("agents.create")} pending={t("common.loading")} className="grid gap-4">
              <label className="grid max-w-md gap-1.5"><span className="label text-ink-2">{t("agents.name")}</span><input name="name" required maxLength={60} placeholder={t("agents.namePlaceholder")} className="field" /></label>
              <label className="flex items-center gap-3 text-[14.5px]"><input type="checkbox" name="comp" className="h-5 w-5" />{t("agents.comp")}</label>
              <label className="flex items-center gap-3 text-[14.5px]"><input type="checkbox" name="contacts" className="h-5 w-5" />{t("agents.contacts")}</label>
            </ActionForm>
          </div>
        </section>

        <div className="grid content-start">
          <section className="grid gap-4 border-b-2 rule px-4 py-7 sm:px-10">
            <h2 className="heading text-[22px]">{t("agents.connect")}</h2>
            <h3 className="label text-ink-2">{t("agents.claudeCode")}</h3>
            <p className="text-[14px] text-ink-2">{t("agents.claudeCodeLead")}</p>
            <Snippet {...copy} text={`claude mcp add --transport http shukatsu ${base}/mcp --header "Authorization: Bearer shk_agent_…"`} />
            <p className="text-[14px] text-ink-2">{t("agents.stdio")}</p>
            <Snippet {...copy} text={`SHUKATSU_URL=${base} SHUKATSU_TOKEN=shk_agent_… node shukatsu/mcp-stdio.mjs`} />
            <h3 className="label mt-2 text-ink-2">{t("agents.remote")}</h3>
            <p className="text-[14px] text-ink-2">{t("agents.remoteLead")}</p>
            <Snippet {...copy} text={`${base}/mcp`} />
            <h3 className="label mt-2 text-ink-2">{t("agents.api")}</h3>
            <p className="text-[14px] text-ink-2">{t("agents.apiLead")}</p>
            <Snippet {...copy} text={`curl -s -X POST ${base}/api/v1/ops/tracker.list -H "Authorization: Bearer shk_agent_…" -H "Content-Type: application/json" -d '{}'`} />
          </section>
          <section className="grid gap-4 px-4 py-7 sm:px-10">
            <h2 className="heading text-[22px]">{t("agents.capture")}</h2>
            <p className="text-[14.5px] text-ink-2">{t("agents.captureLead")}</p>
            <Bookmarklet href={bookmarklet(base)} label={t("agents.bookmarklet")} hint={t("agents.dragHint")} />
          </section>
        </div>
      </div>
    </div>
  );
}
