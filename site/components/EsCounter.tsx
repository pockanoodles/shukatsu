"use client";

// An entry-sheet answer, counted the way the app counts written answers: by
// grapheme, as forms do, against the limit and the 80% fill norm Japanese
// readers expect. Shu means the answer needs work (under 80%, or over the
// limit); ink means it is within the norm. The visitor can edit it.
import { useMemo, useState } from "react";
import type { Dict } from "@/content/copy";
import { ES_ANSWER } from "@/content/copy";

const NORM = 0.8;
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;
const count = (s: string) => (segmenter ? [...segmenter.segment(s)].length : Array.from(s).length);

export function EsCounter({ t }: { t: Dict["japanese"]["es"] }) {
  const [text, setText] = useState(ES_ANSWER);
  const n = useMemo(() => count(text), [text]);
  const fill = n / t.limit;
  const state = n > t.limit ? "over" : fill < NORM ? "under" : "ok";
  return (
    <figure className="es">
      <figcaption className="es__head label">
        <span>{t.caption}</span>
        <span>{t.note}</span>
      </figcaption>
      <label htmlFor="es-answer" className="es__q" lang="ja">
        {t.question}
      </label>
      <textarea id="es-answer" lang="ja" className="es__field" rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="es__meter" data-state={state}>
        <div className="es__bar" aria-hidden>
          <span className="es__fill" style={{ transform: `scaleX(${Math.min(fill, 1)})` }} />
          <span className="es__norm" />
        </div>
        <p className="es__count" aria-live="polite">
          <span className="num">
            {n} / {t.limit}
            {t.unit === "字" ? "字" : ` ${t.unit}`}
          </span>
          <span className="num">{Math.round(fill * 100)}%</span>
          <span className="es__state">{t[state]}</span>
        </p>
        <p className="label es__legend">
          <span>0</span>
          <span>{t.norm}</span>
          <span>{t.limit}</span>
        </p>
      </div>
    </figure>
  );
}
