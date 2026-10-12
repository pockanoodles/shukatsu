"use client";

// One review item, decided on the page the way the app decides it
// (../shukatsu/src/app/(app)/review/decide.tsx): Confirm is the shu pill,
// the other answers are ghost pills, and correcting a figure or dropping the
// figures opens a wording field first. Deciding presses the hanko onto the
// item; "I don't know" leaves the dashed one the app uses for an unsure fact.
// Nothing is sent anywhere: this is an example item, and it resets.
import { useRef, useState } from "react";
import type { Dict, Outcome } from "@/content/copy";
import { Claim, figureCount } from "./Claim";

const ORDER: Outcome[] = ["accept", "correct", "narrative", "unsure"];
// The kanji each answer presses, as in the app: 確認, 直す, 残す, 不明.
const SEAL: Record<Outcome, string> = { accept: "確", correct: "直", narrative: "残", unsure: "不" };
const Seal = ({ k }: { k: string }) => (
  <span className="seal" aria-hidden>
    {k}
  </span>
);
const FIGURES = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const figures = (s: string): string[] => s.match(FIGURES) ?? [];

export function ReviewDemo({ t }: { t: Dict["review"] }) {
  const [open, setOpen] = useState<"correct" | "narrative" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [text, setText] = useState(t.original);
  const [draft, setDraft] = useState(t.original);
  const field = useRef<HTMLTextAreaElement>(null);

  const before = figures(t.original);
  const changed = outcome === "correct" ? figures(text).filter((f) => !before.includes(f)) : [];

  const choose = (o: Outcome) => {
    if (o === "correct" || o === "narrative") {
      const next = open === o ? null : o;
      setOpen(next);
      setDraft(o === "correct" ? t.original : t.narrative);
      if (next) requestAnimationFrame(() => field.current?.focus());
      return;
    }
    setOpen(null);
    setOutcome(o);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!open || !draft.trim()) return;
    setText(draft.trim());
    setOutcome(open);
    setOpen(null);
  };

  const reset = () => {
    setOutcome(null);
    setOpen(null);
    setText(t.original);
  };

  // The app's keys, while focus is inside the item and not in the field.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) return setOpen(null);
    if (outcome || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("textarea")) return;
    const hit = ORDER.find((o) => t.outcomes[o].key?.toLowerCase() === e.key.toLowerCase());
    if (hit) {
      e.preventDefault();
      choose(hit);
    }
  };

  const decided = outcome !== null;
  return (
    <div className="review" onKeyDown={onKey} data-decided={outcome ?? undefined}>
      <figure className="review__item">
        <figcaption className="review__head label">
          <span>{t.proposedBy}</span>
          <span>{t.note}</span>
        </figcaption>
        <div className="review__body">
          <p className="heading review__q">{t.question}</p>
          <p className="review__claim">
            <Claim text={text} changed={changed} />
          </p>
          <p className="review__mom">
            <span className="label">{t.noteLabel}</span>
            <span>{t.momNote}</span>
          </p>
          {!decided && figureCount(text) > 0 && <p className="label review__figs">{t.figures}</p>}
          {outcome ? (
            outcome === "unsure" ? (
              <span key="unsure" className="stamp dashed review__stamp" aria-hidden>
                不明
              </span>
            ) : (
              <span key={outcome} className="stamp two press review__stamp" aria-hidden>
                本人
                <br />
                確認
              </span>
            )
          ) : (
            <span className="stamp two sm review__stamp review__stamp--waiting" aria-hidden>
              確認
              <br />
              待ち
            </span>
          )}
        </div>

        <div className="review__decide">
          {outcome ? (
            <div className="review__done">
              <p className="review__status">{t.done[outcome]}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                {t.reopen}
              </button>
            </div>
          ) : (
            <>
              <div className="review__outcomes" role="group" aria-label={t.figures}>
                {ORDER.map((o) => {
                  const { label, key } = t.outcomes[o];
                  const form = o === "correct" || o === "narrative";
                  const pill = `btn ${o === "accept" ? "btn-shu" : open === o ? "" : "btn-ghost"}`;
                  return (
                    <button
                      key={o}
                      type="button"
                      className={pill}
                      title={t.outcomes[o].lead}
                      aria-keyshortcuts={key}
                      aria-expanded={form ? open === o : undefined}
                      onClick={() => choose(o)}
                    >
                      <Seal k={SEAL[o]} />
                      {label}
                      {key && <kbd>{key}</kbd>}
                    </button>
                  );
                })}
              </div>
              {open ? (
                <form className="review__form" onSubmit={submit}>
                  <label className="label" htmlFor="review-wording">
                    {t.editLabel}
                  </label>
                  <p className="review__help">{open === "correct" ? t.correctHelp : t.narrativeHelp}</p>
                  <textarea id="review-wording" ref={field} className="review__field" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div>
                    <button type="submit" className="btn">
                      <Seal k={SEAL[open]} />
                      {open === "correct" ? t.submitEdit : t.submitNarrative}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="review__leads">
                  {ORDER.map((o) => (
                    <div key={o}>
                      <dt>{t.outcomes[o].label}</dt>
                      <dd>{t.outcomes[o].lead}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      </figure>
      <p className="review__foot" role="status">
        {outcome ? <span className="sr-only">{t.done[outcome]}</span> : null}
        {t.footnote}
      </p>
    </div>
  );
}
