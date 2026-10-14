"use client";

import { useActionState } from "react";
import { dismissSuggestionAction, setAnswerAction, setCountryAction } from "@/app/actions/answers";
import { Submit } from "@/components/client";

type L = Record<string, string>;
export type Target = { key?: string; country?: string; question?: string };

const Msg = ({ s }: { s: { ok: boolean; message?: string; error?: string } | null }) =>
  s ? <span role={s.ok ? "status" : "alert"} className={`text-[14px] ${s.ok ? "" : "text-shu"}`}>{s.ok ? s.message : s.error}</span> : null;

const Hidden = ({ target }: { target: Target }) => (
  <>
    {target.key && <input type="hidden" name="key" value={target.key} />}
    {target.country && <input type="hidden" name="country" value={target.country} />}
    {target.question && <input type="hidden" name="question" value={target.question} />}
  </>
);

/** One stated answer: its value, saved or cleared. `placeholder` is what the profile would fill instead. */
export function AnswerForm({ target, label, value, placeholder, list, l }: { target: Target; label: string; value: string; placeholder?: string; list?: string[]; l: L }) {
  const [state, action] = useActionState(setAnswerAction, null);
  const id = `answer-${(target.key || target.question || "").replace(/[^a-z0-9]+/gi, "-")}`;
  const listId = list?.length ? `${id}-opts` : undefined;
  return (
    <form action={action} className="grid gap-x-4 gap-y-1.5 border-b hair py-2.5 sm:grid-cols-[150px_1fr_auto] sm:items-center">
      <Hidden target={target} />
      <label htmlFor={id} className="label text-ink-2">{label}</label>
      <input id={id} name="value" defaultValue={value} placeholder={placeholder} list={listId} autoComplete="off" className="field" maxLength={300} />
      {listId && <datalist id={listId}>{list!.map((o) => <option key={o} value={o} />)}</datalist>}
      <div className="flex flex-wrap items-center gap-4">
        <Submit className="btn btn-sm" pending={l.working}>{l.save}</Submit>
        {value && <button name="clear" value="1" className="label text-ink-2 underline underline-offset-4">{l.clear}</button>}
        <Msg s={state} />
      </div>
    </form>
  );
}

/** A question in its exact wording, with its answer; a new one when `question` is empty. */
export function QuestionForm({ question, answer, l }: { question?: string; answer?: string; l: L }) {
  const [state, action] = useActionState(setAnswerAction, null);
  return (
    <form action={action} className="grid gap-3 border-b hair py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="grid gap-1.5">
        <span className="label text-ink-2">{l.q}</span>
        {question ? <><input type="hidden" name="question" value={question} /><span className="py-2">{question}</span></>
          : <input name="question" required autoComplete="off" className="field" maxLength={300} />}
      </label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.a}</span><input name="value" defaultValue={answer} required={!question} autoComplete="off" className="field" maxLength={300} /></label>
      <div className="flex flex-wrap items-center gap-4">
        <Submit className="btn btn-sm" pending={l.working}>{question ? l.save : l.add}</Submit>
        {question && <button name="clear" value="1" className="label text-ink-2 underline underline-offset-4">{l.clear}</button>}
        <Msg s={state} />
      </div>
    </form>
  );
}

const yn = (current: string, l: L) => [...new Set(["", "Yes", "No", current].filter((x) => x !== undefined))].map((o) => <option key={o} value={o}>{o === "" ? l.blank : o}</option>);

/** One country's work authorization and sponsorship. A new country when `country` is empty. */
export function CountryForm({ country, work = "", sponsorship = "", l }: { country?: string; work?: string; sponsorship?: string; l: L }) {
  const [state, action] = useActionState(setCountryAction, null);
  return (
    <form action={action} className="grid gap-3 border-b hair py-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
      <label className="grid gap-1.5">
        <span className="label text-ink-2">{l.country}</span>
        {country ? <><input type="hidden" name="country" value={country} /><span className="py-2 font-medium">{country}</span></>
          : <input name="country" required placeholder={l.countryHint} autoComplete="off" className="field" maxLength={80} />}
      </label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.work}</span><select name="auth.work" defaultValue={work} className="field">{yn(work, l)}</select></label>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.sponsorship}</span><select name="auth.sponsorship" defaultValue={sponsorship} className="field">{yn(sponsorship, l)}</select></label>
      <div className="flex flex-wrap items-center gap-4"><Submit className="btn btn-sm" pending={l.working}>{country ? l.save : l.add}</Submit><Msg s={state} /></div>
    </form>
  );
}

/** A suggestion from a fill: its value, editable, accepted as stated or dismissed. */
export function SuggestionForm({ id, target, value, l }: { id: number; target: Target; value: string; l: L }) {
  const [state, action] = useActionState(setAnswerAction, null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Hidden target={target} />
        <input type="hidden" name="suggestion" value={id} />
        <input name="value" defaultValue={value} required autoComplete="off" className="field min-w-[220px]" maxLength={300} aria-label={l.as} />
        <Submit className="btn btn-sm" pending={l.working}>{l.accept}</Submit>
      </form>
      <form action={dismissSuggestionAction}><input type="hidden" name="id" value={id} /><button className="label text-ink-2 underline underline-offset-4">{l.dismiss}</button></form>
      <Msg s={state} />
    </div>
  );
}
