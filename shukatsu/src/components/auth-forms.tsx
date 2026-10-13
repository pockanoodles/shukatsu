"use client";

import { useActionState, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { acceptInviteAction, passkeyLoginOptions, passkeyLoginVerify, passkeyRegisterOptions, passkeyRegisterVerify, signInAction } from "@/app/actions/auth";
import { Submit } from "./client";

type L = Record<string, string>;

export function SignInForm({ next, l }: { next: string; l: L }) {
  const [state, action] = useActionState(signInAction, null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usePasskey = async () => {
    setPasskeyError(null);
    setBusy(true);
    try {
      const optionsJSON = await passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON });
      const r = await passkeyLoginVerify(response, next);
      if (r.ok) window.location.assign(String(r.data || "/today"));
      else setPasskeyError(r.error || l.failed);
    } catch (e) {
      setPasskeyError((e as Error)?.name === "NotAllowedError" ? l.cancelled : l.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.login}</span>
          <input name="login" required autoComplete="username" autoCapitalize="none" spellCheck={false} className="field" /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.password}</span>
          <input name="password" type="password" required autoComplete="current-password" className="field" /></label>
        {state && !state.ok && <p role="alert" className="text-[14px] text-shu">{state.error}</p>}
        <Submit className="btn" pending={l.working}>{l.submit}</Submit>
      </form>
      <div className="flex items-center gap-4 text-ink-3"><span className="h-px flex-1 bg-hair" /><span className="label">{l.or}</span><span className="h-px flex-1 bg-hair" /></div>
      <button type="button" onClick={usePasskey} disabled={busy} className="btn btn-ghost">{busy ? l.working : l.passkey}</button>
      {passkeyError && <p role="alert" className="text-[14px] text-shu">{passkeyError}</p>}
    </div>
  );
}

export function InviteForm({ token, reset, defaults, l }: { token: string; reset: boolean; defaults: { name: string; lang: string }; l: L }) {
  const [state, action] = useActionState(acceptInviteAction, null);
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="ui" value={defaults.lang} />
      {!reset && (
        <>
          <label className="grid gap-1.5"><span className="label text-ink-2">{l.name}</span>
            <input name="name" defaultValue={defaults.name} required className="field" autoComplete="name" />
            {l.nameHelp && <span className="text-[13px] text-ink-3">{l.nameHelp}</span>}</label>
          <label className="grid gap-1.5"><span className="label text-ink-2">{l.login}</span>
            <input name="login" required autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}" className="field" />
            <span className="text-[13px] text-ink-3">{l.loginHelp}</span></label>
          <label className="grid gap-1.5"><span className="label text-ink-2">{l.language}</span>
            <select name="lang" defaultValue={defaults.lang} className="field"><option value="en">English</option><option value="ja">日本語</option></select></label>
        </>
      )}
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.password}</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className="field" />
        <span className="text-[13px] text-ink-3">{l.passwordHelp}</span></label>
      {state && !state.ok && <p role="alert" className="text-[14px] text-shu">{state.error}</p>}
      <Submit className="btn btn-shu" pending={l.working}>{l.submit}</Submit>
    </form>
  );
}

export function AddPasskey({ l }: { l: L }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.name}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="field max-w-sm" placeholder="iPhone" maxLength={60} /></label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy} className="btn btn-ghost" onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const optionsJSON = await passkeyRegisterOptions();
            const response = await startRegistration({ optionsJSON });
            const r = await passkeyRegisterVerify(response, name);
            setMsg({ ok: r.ok, text: r.ok ? (r.message || l.added) : (r.error || l.failed) });
            if (r.ok) window.location.reload();
          } catch (e) {
            setMsg({ ok: false, text: (e as Error)?.message || l.failed });
          } finally {
            setBusy(false);
          }
        }}>{busy ? l.working : l.add}</button>
        {msg && <span role="status" className={`text-[14px] ${msg.ok ? "" : "text-shu"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
