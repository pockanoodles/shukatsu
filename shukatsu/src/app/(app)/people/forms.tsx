"use client";

import { useActionState } from "react";
import { inviteAction, resetLinkAction } from "@/app/actions/work";
import { CopyButton, Submit } from "@/components/client";

type L = Record<string, string>;

function LinkOnce({ url, text, l }: { url: string; text: string; l: L }) {
  return (
    <div className="fade grid gap-3 border-2 border-shu p-4">
      <p className="text-[14.5px]">{text}</p>
      <code className="code break-all bg-paper-2 p-3 text-[13px]">{url}</code>
      <CopyButton text={url} label={l.copyLink} done={l.copied} className="btn btn-shu btn-sm justify-self-start" />
    </div>
  );
}

export function InviteForm({ base, roles, l }: { base: string; roles: { id: string; label: string; help: string }[]; l: L }) {
  const [state, action] = useActionState(inviteAction, null);
  const made = state?.ok ? (state.data as { token: string; name: string }) : null;
  return (
    <div className="grid gap-5">
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.name}</span><input name="name" required className="field" maxLength={60} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.relation}</span><input name="relation" className="field" placeholder={l.relationHelp} maxLength={60} /></label>
        <fieldset className="grid gap-2 sm:col-span-2"><legend className="label mb-2 text-ink-2">{l.role}</legend>
          <div className="grid border-2 rule sm:grid-cols-3">
            {roles.map((r, i) => (
              <label key={r.id} className={`flex cursor-pointer flex-col gap-1 p-4 has-[:checked]:bg-ink has-[:checked]:text-on-ink ${i < roles.length - 1 ? "border-b-2 sm:border-b-0 sm:border-r-2" : ""} rule`}>
                <input type="radio" name="role" value={r.id} defaultChecked={i === 0} className="sr-only" />
                <span className="heading text-[17px]">{r.label}</span>
                <span className="text-[13px] opacity-80">{r.help}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.language}</span>
          <select name="lang" className="field" defaultValue="ja"><option value="ja">日本語</option><option value="en">English</option></select></label>
        <div className="flex items-end"><Submit className="btn" pending={l.working}>{l.create}</Submit></div>
        {state && !state.ok && <p role="alert" className="text-[14px] text-shu sm:col-span-2">{state.error}</p>}
      </form>
      {made && <LinkOnce url={`${base}/invite/${made.token}`} text={l.linkReady.replace("{name}", made.name)} l={l} />}
    </div>
  );
}

export function ResetLink({ id, name, base, l }: { id: number; name: string; base: string; l: L }) {
  const [state, action] = useActionState(resetLinkAction, null);
  return (
    <div className="grid gap-3">
      <form action={action}><input type="hidden" name="id" value={id} /><Submit className="label text-ink-2 underline underline-offset-4 hover:text-ink" pending={l.working}>{l.resetLink}</Submit></form>
      {state?.ok && <LinkOnce url={`${base}/invite/${String(state.data)}`} text={l.resetReady.replace("{name}", name)} l={l} />}
      {state && !state.ok && <p role="alert" className="text-[13px] text-shu">{state.error}</p>}
    </div>
  );
}
