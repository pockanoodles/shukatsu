"use client";

import { useState } from "react";
import { replyAskAction } from "@/app/actions/asks";
import { countChars, countWords } from "@/lib/count";
import { Submit } from "@/components/client";

/**
 * The one form a person asked answers on: their version of the item, counted
 * live against the form's limit when it is a written answer, a word for the
 * candidate, and the two ways to answer.
 */
export function AskReply({ id, initial, lang, limit, unit, multiline, l }: {
  id: number; initial: string; lang: string; limit: number | null; unit: "chars" | "words"; multiline: boolean; l: Record<string, string>;
}) {
  const [text, setText] = useState(initial);
  const used = unit === "words" ? countWords(text) : countChars(text);
  const over = limit ? used > limit : false;
  const under = lang === "ja" && unit === "chars" && limit ? used < limit * 0.8 : false;
  return (
    <form action={replyAskAction} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.yours}</span>
        <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} rows={multiline ? 9 : 4} lang={lang}
          className="field text-[17px] leading-[1.8]" maxLength={multiline ? 10_000 : 400} /></label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`label num ${over ? "text-shu" : "text-ink-2"}`}>{limit ? l.used.replace("{used}", String(used)).replace("{limit}", String(limit)) : used} {unit === "words" ? l.words : l.chars}</span>
        {over && <span className="text-[13px] text-shu">{l.over.replace("{n}", String(used - (limit || 0)))}</span>}
        {under && <span className="text-[13px] text-ink-2">{l.underFilled}</span>}
      </div>
      <label className="grid gap-1.5"><span className="label text-ink-2">{l.yourNote}</span>
        <input name="note" maxLength={1000} className="field" /></label>
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        <Submit className="btn">{l.submit}</Submit>
        <Submit className="btn btn-ghost" name="fine" value="1">{l.fine}</Submit>
      </div>
    </form>
  );
}
