"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { candidateJaAction, lintAction, recordAction } from "@/app/actions/work";
import { Submit, WordingField } from "@/components/client";

type L = Record<string, string>;

function Result({ state }: { state: { ok: boolean; message?: string; error?: string } | null }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`whitespace-pre-line text-[14px] ${state.ok ? "text-ink" : "text-shu"}`}>{state.ok ? state.message : state.error}</p>;
}

/** One expandable action on a row: the trigger, then its form. Closes itself after a success. */
function Panel({ label, children, tone = "ghost" }: { label: string; children: (done: () => void) => React.ReactNode; tone?: "ghost" | "link" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={tone === "link" ? "label justify-self-start text-ink-2 underline underline-offset-4 hover:text-ink" : "btn btn-ghost btn-sm justify-self-start"}>{label}</button>
      {open && <div className="fade border-l-4 border-ink pl-4">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function useClosing(state: { ok: boolean } | null, done: () => void) {
  const fired = useRef(false);
  useEffect(() => { if (state?.ok && !fired.current) { fired.current = true; setTimeout(done, 1200); } }, [state, done]);
}

function RewordForm({ id, part, text, current, owner, l, done }: { id: string; part: string | null; text: string; current: boolean; owner: boolean; l: L; done: () => void }) {
  const [state, action] = useActionState(recordAction, null);
  useClosing(state, done);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="kind" value="fact.edit" />
      <input type="hidden" name="id" value={id} />
      {part && <input type="hidden" name="part" value={part} />}
      <WordingField name="text" defaultValue={text} original={text} current={current} lint={lintAction} autoFocus checkRules={part !== "ja"}
        labels={{ chars: l.chars, pass: l.pass, figures: l.figures }} />
      {!owner && <label className="grid gap-1.5"><span className="label text-ink-2">{l.note}</span><input name="note" className="field" maxLength={1000} /></label>}
      <div><Submit className="btn btn-sm" pending={l.working}>{owner ? l.submitDirect : l.submitPropose}</Submit></div>
      <Result state={state} />
    </form>
  );
}

function RetireForm({ id, owner, l, done }: { id: string; owner: boolean; l: L; done: () => void }) {
  const [state, action] = useActionState(recordAction, null);
  useClosing(state, done);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="kind" value="fact.retire" />
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.reasonRetire}</span><input name="reason" required className="field" maxLength={300} /></label>
      <div><Submit className="btn btn-ghost btn-sm" pending={l.working}>{owner ? l.retire : l.submitPropose}</Submit></div>
      <Result state={state} />
    </form>
  );
}

export function FactActions({ id, text, ja, current, owner, l }: { id: string; text: string; ja: string | null; current: boolean; owner: boolean; l: L }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <Panel label={owner ? l.editDirect : l.suggestEdit} tone="link">{(done) => <RewordForm id={id} part={null} text={text} current={current} owner={owner} l={l} done={done} />}</Panel>
      {ja != null && <Panel label={`${l.ja}: ${owner ? l.editDirect : l.suggestEdit}`} tone="link">{(done) => <RewordForm id={id} part="ja" text={ja} current={current} owner={owner} l={l} done={done} />}</Panel>}
      <Panel label={owner ? l.retire : `${l.retire}?`} tone="link">{(done) => <RetireForm id={id} owner={owner} l={l} done={done} />}</Panel>
    </div>
  );
}

export function NewFact({ entity, tags, current, owner, l }: { entity: string; tags: string[]; current: boolean; owner: boolean; l: L }) {
  return (
    <Panel label={owner ? `+ ${l.addDirect}` : `+ ${l.suggestNew}`}>
      {(done) => <NewFactForm entity={entity} tags={tags} current={current} owner={owner} l={l} done={done} />}
    </Panel>
  );
}

function NewFactForm({ entity, tags, current, owner, l, done }: { entity: string; tags: string[]; current: boolean; owner: boolean; l: L; done: () => void }) {
  const [state, action] = useActionState(recordAction, null);
  useClosing(state, done);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="kind" value="fact.new" />
      <input type="hidden" name="entity" value={entity} />
      <div className="grid gap-1.5">
        <span className="label text-ink-2">{l.newText}</span>
        <WordingField name="text" defaultValue="" current={current} lint={lintAction} autoFocus labels={{ chars: l.chars, pass: l.pass, figures: l.figures }} />
      </div>
      <fieldset className="grid gap-2"><legend className="label mb-2 text-ink-2">{l.tags}</legend>
        <div className="flex flex-wrap gap-2">
          {tags.map((tg) => (
            <label key={tg} className="label flex min-h-11 cursor-pointer items-center gap-2 border-2 rule px-3 has-[:checked]:bg-ink has-[:checked]:text-on-ink">
              <input type="checkbox" name="tags" value={tg} className="sr-only" />{tg}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.priority}</span>
          <select name="priority" defaultValue="2" className="field"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label className="grid gap-1.5"><span className="label text-ink-2">{l.newJa} <span className="text-ink-3">({l.optional})</span></span><input name="ja" lang="ja" className="field" maxLength={400} /></label>
      </div>
      {!owner && <label className="grid gap-1.5"><span className="label text-ink-2">{l.note}</span><input name="note" className="field" maxLength={1000} /></label>}
      <div><Submit className="btn btn-sm" pending={l.working}>{owner ? l.submitDirect : l.submitPropose}</Submit></div>
      <Result state={state} />
    </form>
  );
}

export function NewRole({ owner, l }: { owner: boolean; l: L }) {
  return <Panel label={owner ? `+ ${l.addRole}` : `+ ${l.suggestRole}`}>{(done) => <NewRoleForm owner={owner} l={l} done={done} />}</Panel>;
}

function NewRoleForm({ owner, l, done }: { owner: boolean; l: L; done: () => void }) {
  const [state, action] = useActionState(recordAction, null);
  useClosing(state, done);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="kind" value="entity.new" />
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.roleSection}</span>
        <select name="section" className="field" defaultValue="work">
          {["work", "projects", "volunteering", "education"].map((s) => <option key={s} value={s}>{l[`sec_${s}`]}</option>)}
        </select></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.roleLabel}</span><input name="label" required className="field" maxLength={80} /></label>
      <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.roleHeading}</span><input name="heading" className="field" placeholder="Company -- City, ST" maxLength={120} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.roleTitle}</span><input name="title" className="field" maxLength={120} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.roleDates}</span><input name="dates" className="field" placeholder="May 2026 – August 2026" maxLength={80} /></label>
      <label className="flex min-h-11 items-center gap-3 sm:col-span-2"><input type="checkbox" name="ended" defaultChecked className="h-5 w-5 accent-[var(--ink)]" /><span>{l.roleEnded}</span></label>
      {!owner && <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.note}</span><input name="note" className="field" maxLength={1000} /></label>}
      <div className="sm:col-span-2"><Submit className="btn btn-sm" pending={l.working}>{owner ? l.submitDirect : l.submitPropose}</Submit></div>
      <div className="sm:col-span-2"><Result state={state} /></div>
    </form>
  );
}

/** The candidate's Japanese contact block, printed by a 職務経歴書 in place of the English. */
export function JaHeaderForm({ values, english, l }: { values: Record<string, string>; english: Record<string, string>; l: L }) {
  const [state, action] = useActionState(candidateJaAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.jaName}</span>
        <input name="name" defaultValue={values.name || ""} lang="ja" className="field" placeholder={english.name} maxLength={200} /></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.jaLocation}</span>
        <input name="location" defaultValue={values.location || ""} lang="ja" className="field" placeholder={english.location} maxLength={200} /></label>
      <label className="grid gap-1.5 sm:col-span-2"><span className="label text-ink-2">{l.jaAvailability}</span>
        <input name="availability" defaultValue={values.availability || ""} lang="ja" className="field" placeholder="例：6ヶ月の長期インターン（2027年1月〜6月）" maxLength={200} />
        <span className="text-[12.5px] text-ink-3">{english.availability}</span></label>
      <div className="flex items-center gap-3 sm:col-span-2"><Submit className="btn btn-sm" pending={l.working}>{l.jaSave}</Submit>
        <Result state={state} /></div>
    </form>
  );
}
