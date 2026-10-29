import { askAction } from "@/app/actions/asks";
import { Submit } from "@/components/client";

export type Askable = { id: number; name: string };

/**
 * "Ask someone to look" under one item: pick a person, say what to look at.
 * Closed by default so a page with many answers stays readable. `asked` names
 * who already has this item open.
 */
export function AskForm({ subject, people, asked, path, l }: { subject: string; people: Askable[]; asked: string[]; path: string; l: Record<string, string> }) {
  return (
    <details className="group">
      <summary className="label cursor-pointer select-none text-ink-2 underline underline-offset-4 hover:text-ink">
        {l.ask}{asked.length > 0 && <span className="ml-2 text-shu no-underline">{l.asked.replace("{names}", asked.join(", "))}</span>}
      </summary>
      {people.length ? (
        <form action={askAction} className="mt-3 grid gap-2 border-2 rule p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="path" value={path} />
          <label className="grid gap-1"><span className="label text-ink-3">{l.who}</span>
            <select name="to" className="field" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="grid gap-1"><span className="label text-ink-3">{l.note}</span>
            <input name="note" maxLength={1000} placeholder={l.notePlaceholder} className="field" /></label>
          <Submit className="btn btn-sm">{l.send}</Submit>
        </form>
      ) : <p className="mt-2 text-[13px] text-ink-2">{l.nobody}</p>}
    </details>
  );
}
