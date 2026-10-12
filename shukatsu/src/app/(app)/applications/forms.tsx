"use client";

import { useActionState, useEffect, useRef } from "react";
import { postingAction, statusAction } from "@/app/actions/work";
import { Submit } from "@/components/client";

type L = Record<string, string>;

export function PostingForm({ owner, l }: { owner: boolean; l: L }) {
  const [state, action] = useActionState(postingAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  return (
    <form ref={form} action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.url}</span>
        <input name="url" type="url" required inputMode="url" placeholder="https://" className="field" /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.company}</span><input name="company" className="field" maxLength={80} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.role}</span><input name="role" className="field" maxLength={120} /></label>
      <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.note}</span><input name="note" className="field" maxLength={300} /></label>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <Submit className="btn" pending={l.working}>{owner ? l.submitOwner : l.submit}</Submit>
        {state && <span role={state.ok ? "status" : "alert"} className={`text-[14px] ${state.ok ? "" : "text-shu"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
    </form>
  );
}

export function StatusForm({ num, current, states, l }: { num: number; current: string; states: { id: string; label: string }[]; l: L }) {
  const [state, action] = useActionState(statusAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="num" value={num} />
      <label className="sr-only" htmlFor={`st-${num}`}>{l.changeStatus}</label>
      <select id={`st-${num}`} name="state" defaultValue={states.find((s) => s.label.toLowerCase() === current.toLowerCase())?.label || current}
        className="field min-h-9 w-auto py-1 pr-8 text-[13px]" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {states.map((s) => <option key={s.id} value={s.label}>{l[`state_${s.id}`] || s.label}</option>)}
      </select>
      <noscript><button className="btn btn-sm">{l.changeStatus}</button></noscript>
      {state && !state.ok && <span role="alert" className="text-[12.5px] text-shu">{state.error}</span>}
    </form>
  );
}
