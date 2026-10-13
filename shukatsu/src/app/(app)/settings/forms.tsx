"use client";

import { useActionState, useState } from "react";
import { accountAction, passwordAction } from "@/app/actions/work";
import { Submit } from "@/components/client";

type L = Record<string, string>;

const Msg = ({ s }: { s: { ok: boolean; message?: string; error?: string } | null }) =>
  s ? <span role={s.ok ? "status" : "alert"} className={`text-[14px] ${s.ok ? "" : "text-shu"}`}>{s.ok ? s.message : s.error}</span> : null;

export function AccountForm({ name, email, lang, l }: { name: string; email: string; lang: string; l: L }) {
  const [state, action] = useActionState(accountAction, null);
  // A message answers the last submit; editing a field means it no longer applies.
  const [edited, setEdited] = useState<unknown>(null);
  return (
    <form action={action} onInput={() => setEdited(state)} className="grid max-w-xl gap-4">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.name}</span><input name="name" defaultValue={name} required className="field" maxLength={60} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.email}</span><input name="email" type="email" defaultValue={email} className="field" /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.language}</span>
        <select name="lang" defaultValue={lang} className="field"><option value="en">English</option><option value="ja">日本語</option></select></label>
      <div className="flex items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{l.save}</Submit><Msg s={edited === state ? null : state} /></div>
    </form>
  );
}

export function PasswordForm({ l }: { l: L }) {
  const [state, action] = useActionState(passwordAction, null);
  const [edited, setEdited] = useState<unknown>(null);
  return (
    <form action={action} onInput={() => setEdited(state)} className="grid max-w-xl gap-4">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.current}</span><input name="current" type="password" required autoComplete="current-password" className="field" /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.next}</span><input name="password" type="password" required minLength={10} autoComplete="new-password" className="field" /></label>
      <div className="flex items-center gap-4"><Submit className="btn btn-ghost btn-sm" pending={l.working}>{l.change}</Submit><Msg s={edited === state ? null : state} /></div>
    </form>
  );
}
