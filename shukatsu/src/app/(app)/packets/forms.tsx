"use client";

import { useActionState, useState } from "react";
import { answersAction, bulletAction, coverAction, createPacketAction, lintAction, suggestAction } from "@/app/actions/work";
import { countChars, countWords } from "@/lib/count";
import { Submit, WordingField } from "@/components/client";

type L = Record<string, string>;

export function NewPacketForm({ archetypes, defaults, l }: { archetypes: { id: string; name: string; tags: string[] }[]; defaults: { url: string; company: string; role: string; lang: string }; l: L }) {
  const [state, action] = useActionState(createPacketAction, null);
  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.company}</span><input name="company" required defaultValue={defaults.company} className="field" maxLength={80} /></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.role}</span><input name="role" required defaultValue={defaults.role} className="field" maxLength={120} /></label>
        <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.url}</span><input name="url" type="url" defaultValue={defaults.url} className="field" placeholder="https://" /></label>
      </div>
      <fieldset className="grid gap-3">
        <legend className="label mb-3 text-ink-2">{l.archetype}</legend>
        <div className="grid border-2 rule sm:grid-cols-2 lg:grid-cols-3">
          {archetypes.map((a, i) => (
            <label key={a.id} className={`relative flex min-h-[84px] cursor-pointer flex-col gap-1 p-4 has-[:checked]:bg-ink has-[:checked]:text-on-ink ${i % 3 !== 2 ? "lg:border-r-2" : ""} ${i % 2 === 0 ? "sm:max-lg:border-r-2" : ""} border-b-2 rule`}>
              <input type="radio" name="archetype" value={a.id} required defaultChecked={i === 0} className="sr-only" />
              <span className="heading text-[16px]">{a.name}</span>
              <span className="code text-[11.5px] opacity-75">{a.tags.join(" · ")}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.jd}</span>
        <textarea name="jd" rows={12} className="field code text-[13px] leading-[1.6]" maxLength={60000} /></label>
      <fieldset className="grid gap-2">
        <legend className="label mb-2 text-ink-2">{l.lang}</legend>
        <div className="seg w-fit">
          {[["en", l.langEn], ["ja", l.langJa]].map(([v, label]) => (
            <label key={v} className="cursor-pointer has-[:checked]:bg-ink has-[:checked]:text-on-ink"><input type="radio" name="lang" value={v} defaultChecked={v === defaults.lang} className="sr-only" />{label}</label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Submit className="btn btn-shu" pending={l.working}>{l.submit}</Submit>
        {state && !state.ok && <span role="alert" className="text-[14px] text-shu">{state.error}</span>}
      </div>
    </form>
  );
}

/** Reword one bullet, with optional model suggestions that already passed the gate. */
export function BulletEditor({ packet, fact, text, current, ai, ja = false, l }: { packet: number; fact: string; text: string; current: boolean; ai: boolean; ja?: boolean; l: L }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState({ text, n: 0 });
  const [state, action] = useActionState(bulletAction, null);
  const [sugg, setSugg] = useState<{ suggestions: { text: string }[]; dropped: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="label text-ink-2 underline underline-offset-4 hover:text-ink">{l.reword}</button>;
  return (
    <form action={action} className="fade grid gap-3 border-l-4 border-ink pl-4">
      <input type="hidden" name="packet" value={packet} />
      <input type="hidden" name="fact" value={fact} />
      <WordingField key={seed.n} name="text" defaultValue={seed.text} original={text} current={current} lint={lintAction} autoFocus checkRules={!ja} labels={{ chars: l.chars, pass: l.pass, figures: l.figures }} />
      <div className="flex flex-wrap items-center gap-3">
        <Submit className="btn btn-sm" pending={l.working}>{l.save}</Submit>
        {ai && !ja ? (
          <button type="button" disabled={asking} className="btn btn-ghost btn-sm" onClick={async () => {
            setAsking(true); setErr(null);
            const r = await suggestAction(packet, fact);
            setAsking(false);
            if (r.ok) setSugg(r.data as { suggestions: { text: string }[]; dropped: number }); else setErr(r.error || "");
          }}>{asking ? l.suggesting : l.suggest}</button>
        ) : <span className="text-[12.5px] text-ink-3">{l.suggestOff}</span>}
        <button type="button" className="label text-ink-3 hover:text-ink" onClick={() => setOpen(false)}>{l.cancel}</button>
        {state && <span role={state.ok ? "status" : "alert"} className={`text-[13.5px] ${state.ok ? "" : "text-shu"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
      {err && <p role="alert" className="text-[13.5px] text-shu">{err}</p>}
      {sugg && (
        <div className="grid gap-2">
          <p className="label text-ink-2">{l.suggestions}</p>
          <ul className="grid gap-2">
            {sugg.suggestions.map((s, i) => (
              <li key={i} className="grid gap-2 border hair p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="text-[14.5px]">{s.text}</span>
                <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setSeed({ text: s.text, n: seed.n + 1 })}>{l.use}</button>
              </li>
            ))}
          </ul>
          {sugg.dropped > 0 && <p className="text-[12.5px] text-ink-3">{l.dropped.replace("{n}", String(sugg.dropped))}</p>}
        </div>
      )}
    </form>
  );
}

export function CoverForm({ packet, cover, notes, l }: { packet: number; cover: string; notes: string; l: L }) {
  const [state, action] = useActionState(coverAction, null);
  const [nState, nAction] = useActionState(coverAction, null);
  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-2">
        <input type="hidden" name="packet" value={packet} />
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.cover}</span>
          <textarea name="cover" rows={10} defaultValue={cover} className="field leading-[1.6]" maxLength={8000} /></label>
        <div className="flex items-center gap-3"><Submit className="btn btn-ghost btn-sm" pending={l.working}>{l.saveCover}</Submit>
          {state && <span className={`text-[13px] ${state.ok ? "" : "text-shu"}`}>{state.ok ? state.message : state.error}</span>}</div>
      </form>
      <form action={nAction} className="grid gap-2">
        <input type="hidden" name="packet" value={packet} />
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.notes}</span>
          <textarea name="notes" rows={3} defaultValue={notes} className="field" maxLength={4000} /></label>
        <div className="flex items-center gap-3"><Submit className="btn btn-ghost btn-sm" pending={l.working}>{l.saveNotes}</Submit>
          {nState && <span className={`text-[13px] ${nState.ok ? "" : "text-shu"}`}>{nState.ok ? nState.message : nState.error}</span>}</div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- written answers

type Answer = { question: string; limit: number | null; unit: "chars" | "words"; text: string };
type Check = { used: number; unit: string; limit: number | null; over: boolean; underFilled: boolean; warnings: string[]; flags: { figures: string[]; sentence: string }[] };


/**
 * The form's questions and answers, counted live as you type. Saving re-runs
 * the server check: limits, the 80% fill norm for Japanese, style, and figures.
 */
export function AnswersEditor({ packet, initial, checks, lang, editable, l }: { packet: number; initial: Answer[]; checks: Check[]; lang: string; editable: boolean; l: L }) {
  const [rows, setRows] = useState<Answer[]>(initial.length ? initial : []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Answer>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-5">
      {rows.length === 0 && <p className="text-[14px] text-ink-3">–</p>}
      {rows.map((r, i) => {
        const used = r.unit === "words" ? countWords(r.text) : countChars(r.text);
        const over = r.limit ? used > r.limit : false;
        const under = lang === "ja" && r.unit === "chars" && r.limit ? used < r.limit * 0.8 : false;
        const pct = r.limit ? Math.min(100, Math.round((used / r.limit) * 100)) : 0;
        const server = checks[i];
        return (
          <div key={i} className="grid gap-2 border-t hair pt-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_120px]">
              <label className="grid gap-1"><span className="label text-ink-3">{l.question}</span>
                <input value={r.question} disabled={!editable} onChange={(e) => set(i, { question: e.target.value })} className="field" maxLength={500} /></label>
              <label className="grid gap-1"><span className="label text-ink-3">{l.limit}</span>
                <input type="number" min={0} value={r.limit ?? ""} disabled={!editable} onChange={(e) => set(i, { limit: e.target.value ? Number(e.target.value) : null })} className="field num" /></label>
              <label className="grid gap-1"><span className="label text-ink-3">{l.unit}</span>
                <select value={r.unit} disabled={!editable} onChange={(e) => set(i, { unit: e.target.value as Answer["unit"] })} className="field"><option value="chars">{l.chars}</option><option value="words">{l.words}</option></select></label>
            </div>
            <label className="grid gap-1"><span className="label text-ink-3">{l.answer}</span>
              <textarea value={r.text} disabled={!editable} onChange={(e) => set(i, { text: e.target.value })} rows={6} className="field leading-[1.7]" lang={lang} /></label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {r.limit ? (
                <span className="flex items-center gap-2">
                  <span className="relative h-1.5 w-28 overflow-hidden rounded-full bg-paper-3" aria-hidden><span className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-shu" : "bg-ink"}`} style={{ width: `${pct}%` }} /></span>
                  <span className={`label num ${over ? "text-shu" : "text-ink-2"}`}>{l.used.replace("{used}", String(used)).replace("{limit}", String(r.limit))} {r.unit === "words" ? l.words : l.chars}</span>
                </span>
              ) : <span className="label num text-ink-2">{used} {r.unit === "words" ? l.words : l.chars}</span>}
              {over && <span className="text-[13px] text-shu">{l.over.replace("{n}", String(used - (r.limit || 0)))}</span>}
              {under && <span className="text-[13px] text-ink-2">{l.underFilled}</span>}
              {editable && <button type="button" className="label ml-auto text-ink-3 underline underline-offset-4 hover:text-ink" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{l.removeAnswer}</button>}
            </div>
            {server && [...server.warnings.map((w) => w), ...server.flags.map((f) => l.figureFlag.replace("{figs}", f.figures.join(", ")))].map((w, k) => (
              <p key={k} className="border-l-4 border-shu pl-3 text-[13px] text-shu">{w}</p>
            ))}
          </div>
        );
      })}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { question: "", limit: lang === "ja" ? 400 : null, unit: "chars", text: "" }])}>{l.addAnswer}</button>
          <button type="button" disabled={busy} className="btn btn-sm" onClick={async () => {
            setBusy(true); setMsg(null);
            const r = await answersAction(packet, rows);
            setBusy(false); setMsg({ ok: r.ok, text: r.ok ? (r.message || "") : (r.error || "") });
          }}>{busy ? l.working : l.saveAnswers}</button>
          {msg && <span role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "" : "text-shu"}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
