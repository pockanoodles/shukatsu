"use client";

import { useActionState, useState } from "react";
import { decideAction, lintAction } from "@/app/actions/work";
import { Submit, WordingField } from "@/components/client";

export type Outcome = { id: "accept" | "correct" | "narrative" | "unsure" | "edit" | "reject" | "approve" | "changes" | "add" | "retire"; label: string; lead: string; key?: string; primary?: boolean };

type Labels = {
  reasonLabel: string; reasonPlaceholder: string; editLabel: string; narrativeHelp: string; correctHelp: string;
  submitEdit: string; submitNarrative: string; submitReject: string; submitChanges: string; chars: string; pass: string; figures: string; working: string;
};

const OUTCOME_FOR: Record<Outcome["id"], string> = {
  accept: "accept", correct: "accept", edit: "accept", narrative: "narrative", unsure: "cannot-confirm",
  reject: "reject", approve: "accept", changes: "reject", add: "accept", retire: "accept",
};

/**
 * The decision panel. One-click outcomes submit straight away; the ones that
 * need words (a corrected figure, a narrative rewording, a reason) open their
 * form under the grid. Only one is open at a time.
 */
export function Decide({ itemKey, next, outcomes, rejectLink, text, current, checkRules, labels, stamp }: {
  itemKey: string; next: string | null; outcomes: Outcome[]; rejectLink?: Outcome; text: string; current: boolean; checkRules: boolean; labels: Labels; stamp: string;
}) {
  const [open, setOpen] = useState<Outcome["id"] | null>(null);
  const [state, action] = useActionState(decideAction, null);
  const needsForm = (id: Outcome["id"]) => ["correct", "narrative", "edit", "reject", "changes"].includes(id);
  const hidden = (id: Outcome["id"]) => (
    <>
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="outcome" value={OUTCOME_FOR[id]} />
      {next && <input type="hidden" name="next" value={next} />}
    </>
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2.5" role="group">
        {outcomes.map((o) => {
          const pill = `btn ${o.primary ? "btn-shu" : open === o.id ? "" : "btn-ghost"}`;
          const inner = <>{o.label}{o.key && <kbd className="hidden sm:inline">{o.key.toUpperCase()}</kbd>}</>;
          if (needsForm(o.id)) {
            return (
              <button key={o.id} type="button" data-key={o.key} title={o.lead} aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)} className={pill}>{inner}</button>
            );
          }
          return (
            <form key={o.id} action={action} className="contents">
              {hidden(o.id)}
              <button type="submit" data-key={o.key} title={o.lead} className={pill}>{inner}</button>
            </form>
          );
        })}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] text-ink-2 sm:grid-cols-2">
        {outcomes.map((o) => (
          <div key={o.id} className="flex gap-2"><dt className="font-semibold text-ink">{o.label}</dt><dd>{o.lead}</dd></div>
        ))}
      </dl>

      {rejectLink && (
        <button type="button" data-key={rejectLink.key} onClick={() => setOpen(open === "reject" ? null : "reject")} className="justify-self-start text-[13.5px] text-ink-2 underline underline-offset-4 hover:text-ink">
          {rejectLink.label} →
        </button>
      )}

      {open && (
        <form action={action} className="fade grid gap-3 border-l-4 border-ink pl-4">
          {hidden(open)}
          {(open === "correct" || open === "narrative" || open === "edit") && (
            <>
              <label className="label text-ink-2" htmlFor="wording">{labels.editLabel}</label>
              <p className="-mt-1 text-[13.5px] text-ink-2">{open === "narrative" ? labels.narrativeHelp : open === "correct" ? labels.correctHelp : ""}</p>
              <WordingField name="text" defaultValue={text} original={text} current={current} lint={lintAction} autoFocus checkRules={checkRules}
                labels={{ chars: labels.chars, pass: labels.pass, figures: labels.figures }} />
              <div><Submit className="btn" pending={labels.working}>{open === "narrative" ? labels.submitNarrative : labels.submitEdit}</Submit></div>
            </>
          )}
          {(open === "reject" || open === "changes") && (
            <>
              <label className="label text-ink-2" htmlFor="reason">{labels.reasonLabel}</label>
              <textarea id="reason" name="reason" required rows={2} className="field" placeholder={labels.reasonPlaceholder} autoFocus />
              <div><Submit className="btn" pending={labels.working}>{open === "changes" ? labels.submitChanges : labels.submitReject}</Submit></div>
            </>
          )}
        </form>
      )}

      {state && !state.ok && (
        <p role="alert" className="whitespace-pre-line border-2 border-shu px-4 py-3 text-[14px] text-shu">{state.error}</p>
      )}
      <span className="sr-only">{stamp}</span>
    </div>
  );
}
