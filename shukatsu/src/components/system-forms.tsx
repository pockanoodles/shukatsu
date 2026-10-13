"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { CopyButton, Submit } from "./client";
import { captureAction } from "@/app/actions/system";

type Action = (state: ActionResult | null, form: FormData) => Promise<ActionResult>;

/**
 * A form posting to one server action, with its result under the button.
 * `secret` shows a returned token once, with a copy button, because a token
 * is never shown again after this.
 */
export function ActionForm({ action, submit, pending, className = "grid gap-4", buttonClass = "btn", reset = true, secret, children }: {
  action: Action; submit: React.ReactNode; pending: string; className?: string; buttonClass?: string; reset?: boolean;
  /** `template` turns the token into what's shown and copied, e.g. "https://host/cal/{token}.ics". */
  secret?: { lead: string; copy: string; copied: string; template?: string }; children: React.ReactNode;
}) {
  const [state, run] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && reset) form.current?.reset(); }, [state, reset]);
  const raw = state?.ok && secret && typeof state.data === "string" ? state.data : null;
  const token = raw && secret?.template ? secret.template.replace("{token}", raw) : raw;
  return (
    <div className="grid gap-4">
      <form ref={form} action={run} className={className}>
        {children}
        <div className="flex flex-wrap items-center gap-4 sm:col-span-full">
          <Submit className={buttonClass} pending={pending}>{submit}</Submit>
          {state && !token && <span role={state.ok ? "status" : "alert"} className={`whitespace-pre-line text-[14px] ${state.ok ? "" : "text-shu"}`}>{state.ok ? state.message : state.error}</span>}
        </div>
      </form>
      {token && secret && (
        <div role="status" className="grid gap-3 border-2 border-shu p-4">
          <p className="text-[14px]">{secret.lead}</p>
          <code className="block overflow-x-auto break-all bg-paper-2 px-3 py-2 font-mono text-[13px]">{token}</code>
          <div><CopyButton text={token} label={secret.copy} done={secret.copied} /></div>
        </div>
      )}
    </div>
  );
}

/** A bookmarklet link: dragged to the bookmarks bar, never clicked here. */
export function Bookmarklet({ href, label, hint }: { href: string; label: string; hint: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: hrefs, so the link gets its code after it mounts.
  useEffect(() => { ref.current?.setAttribute("href", href); }, [href]);
  return (
    <span className="flex flex-wrap items-center gap-4">
      <a ref={ref} href="#" onClick={(e) => e.preventDefault()} className="btn" draggable>{label}</a>
      <span className="text-[13px] text-ink-3">{hint}</span>
    </span>
  );
}

type Capture = { url: string; title: string; text: string; selection: string };
type L = Record<string, string>;

/**
 * The capture window. The bookmarklet opens it and posts the page it was
 * pressed on (address, title, visible text). Nothing is saved until the
 * candidate presses Save; a board that blocks the handoff leaves the paste box.
 */
export function CaptureForm({ l }: { l: L }) {
  const [page, setPage] = useState<Capture | null>(null);
  const [fields, setFields] = useState({ company: "", role: "", location: "", note: "", url: "", text: "" });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as Partial<Capture> & { type?: string };
      if (!d || d.type !== "shukatsu.capture" || typeof d.url !== "string" || typeof d.text !== "string") return;
      setPage({ url: d.url, title: String(d.title || ""), text: d.text, selection: String(d.selection || "") });
      setFields((f) => ({ ...f, url: d.url!, text: (d.selection && d.selection.length > 200 ? d.selection : d.text) || "" }));
      (e.source as Window | null)?.postMessage("shukatsu.capture.ok", { targetOrigin: e.origin });
    };
    window.addEventListener("message", onMessage);
    window.opener?.postMessage("shukatsu.capture.ready", "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await captureAction({ url: fields.url, title: page?.title || "", text: fields.text, selection: "", company: fields.company, role: fields.role, location: fields.location, note: fields.note });
    setResult(r);
    setBusy(false);
  };
  const saved = result?.ok ? (result.data as { added: boolean; replaced: boolean; company: string | null; role: string | null }) : null;
  if (saved) {
    return (
      <div className="grid gap-4">
        <p role="status" className="text-[17px]">{saved.replaced ? l.replaced : l.saved}</p>
        {!saved.added && <p className="text-ink-2">{l.already}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn" onClick={() => window.close()}>{l.close}</button>
          <a href="/applications" className="btn btn-ghost">{l.view}</a>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-5">
      {!page && <p className="border-l-4 border-shu pl-4 text-[15px] text-ink-2">{l.waiting}</p>}
      {page && (
        <div className="grid gap-1 border-b hair pb-3">
          <span className="label text-ink-3">{l.from}</span>
          <span className="break-all text-[14px]">{page.title || page.url}</span>
          <span className="label text-ink-3">{l.chars.replace("{n}", String([...fields.text].length))}</span>
        </div>
      )}
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.url}</span><input value={fields.url} onChange={set("url")} type="url" required className="field" placeholder="https://" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.company}</span><input value={fields.company} onChange={set("company")} className="field" maxLength={80} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.role}</span><input value={fields.role} onChange={set("role")} className="field" maxLength={120} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.location}</span><input value={fields.location} onChange={set("location")} className="field" maxLength={120} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.note}</span><input value={fields.note} onChange={set("note")} className="field" maxLength={300} /></label>
      </div>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.text}</span>
        <textarea value={fields.text} onChange={set("text")} rows={10} className="field font-mono text-[12.5px]" placeholder={l.paste} /></label>
      <p className="text-[13px] text-ink-3">{l.untrusted}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn" disabled={busy || !fields.url || fields.text.length < 200} onClick={save}>{busy ? l.working : l.save}</button>
        {result && !result.ok && <span role="alert" className="text-[14px] text-shu">{result.error}</span>}
      </div>
    </div>
  );
}
