"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { commentAction, resolveCommentAction } from "@/app/actions/work";
import { Submit } from "./client";

export type ThreadComment = {
  id: number; parent_id: number | null; author_id: number; author_name: string; role: string; when: string;
  body: string; resolved: boolean;
};
type L = { placeholder: string; reply: string; post: string; resolve: string; resolved: string; cancel: string; working: string };

/**
 * One line that grows as you type: the composer for a new comment and for a
 * reply. Enter with ⌘ or Ctrl posts.
 */
function Composer({ subject, path, parent, l, autoFocus = false, onDone }: { subject: string; path: string; parent?: number; l: L; autoFocus?: boolean; onDone?: () => void }) {
  const [state, action] = useActionState(commentAction, null);
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    if (area.current) area.current.style.height = "";
    done.current?.();
  }, [state]);
  const grow = () => { const a = area.current; if (a) { a.style.height = "auto"; a.style.height = `${Math.min(a.scrollHeight, 220)}px`; } };
  return (
    <form ref={form} action={action} className="grid gap-1">
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="path" value={path} />
      {parent && <input type="hidden" name="parent" value={parent} />}
      <div className="flex items-end gap-2 border-b hair pb-1.5 focus-within:border-ink">
        <label className="sr-only" htmlFor={`c-${subject}-${parent ?? 0}`}>{parent ? l.reply : l.placeholder}</label>
        <textarea ref={area} id={`c-${subject}-${parent ?? 0}`} name="body" rows={1} required maxLength={4000} autoFocus={autoFocus} onInput={grow}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }}
          placeholder={parent ? l.reply : l.placeholder} className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] outline-none placeholder:text-ink-3" />
        {onDone && <button type="button" onClick={onDone} className="label px-2 py-2 text-ink-3 hover:text-ink">{l.cancel}</button>}
        <Submit className="btn btn-sm" pending={l.working}>{l.post}</Submit>
      </div>
      {state && !state.ok && <span role="alert" className="text-[13px] text-shu">{state.error}</span>}
    </form>
  );
}

function Item({ c, kids, all, subject, path, me, canComment, canResolve, l, depth }: {
  c: ThreadComment; kids: ThreadComment[]; all: ThreadComment[]; subject: string; path: string; me: number; canComment: boolean; canResolve: boolean; l: L; depth: number;
}) {
  const [replying, setReplying] = useState(false);
  const children = (id: number) => all.filter((x) => x.parent_id === id);
  if (c.resolved && !kids.length) {
    return (
      <li className="flex min-w-0 items-baseline gap-2 py-1.5 text-[13.5px] text-ink-3">
        <span className="label flex-none">{l.resolved}</span>
        <span className="truncate"><span className="font-bold">{c.author_name}</span> {c.body}</span>
      </li>
    );
  }
  return (
    <li className="py-2">
      <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5">
        <span aria-hidden className="mt-0.5 grid h-[22px] w-[22px] place-items-center bg-ink text-[11px] font-bold text-on-ink">{c.author_name.slice(0, 1).toUpperCase()}</span>
        <div className={`grid gap-0.5 ${c.resolved ? "opacity-60" : ""}`}>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] font-bold">{c.author_name}</span>
            <span className="label text-ink-3">{c.role} · {c.when}</span>
          </p>
          <p className="whitespace-pre-line text-[14.5px] leading-[1.5]">{c.body}</p>
          <p className="flex gap-4 pt-0.5">
            {canComment && depth < 4 && <button type="button" onClick={() => setReplying((v) => !v)} className="label text-ink-3 hover:text-ink">{l.reply}</button>}
            {!c.resolved && (canResolve || c.author_id === me) && (
              <form action={resolveCommentAction}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="path" value={path} />
                <button className="label text-ink-3 hover:text-ink">{l.resolve}</button>
              </form>
            )}
            {c.resolved && <span className="label text-ink-3">{l.resolved}</span>}
          </p>
          {replying && <div className="pt-1"><Composer subject={subject} path={path} parent={c.id} l={l} autoFocus onDone={() => setReplying(false)} /></div>}
        </div>
      </div>
      {kids.length > 0 && (
        <ol className="ml-[10px] mt-1 border-l hair pl-4">
          {kids.map((k) => <Item key={k.id} c={k} kids={children(k.id)} all={all} subject={subject} path={path} me={me} canComment={canComment} canResolve={canResolve} l={l} depth={depth + 1} />)}
        </ol>
      )}
    </li>
  );
}

/** A comment thread as a discussion: replies nest under what they answer; resolved ones fold to a line. */
export function CommentThread({ subject, path, comments, me, canComment, canResolve, title, l }: {
  subject: string; path: string; comments: ThreadComment[]; me: number; canComment: boolean; canResolve: boolean; title: string; l: L;
}) {
  const known = new Set(comments.map((c) => c.id));
  // A reply whose parent is gone stands on its own.
  const roots = comments.filter((c) => !c.parent_id || !known.has(c.parent_id));
  const children = (id: number) => comments.filter((x) => x.parent_id === id);
  if (!comments.length && !canComment) return null;
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 className="label flex items-center gap-2 text-ink-2">{title}{comments.length ? <span className="text-ink-3">{comments.length}</span> : null}</h3>
      {roots.length > 0 && (
        <ol className="grid">
          {roots.map((c) => <Item key={c.id} c={c} kids={children(c.id)} all={comments} subject={subject} path={path} me={me} canComment={canComment} canResolve={canResolve} l={l} depth={0} />)}
        </ol>
      )}
      {canComment && <div className="pt-1"><Composer subject={subject} path={path} l={l} /></div>}
    </section>
  );
}
