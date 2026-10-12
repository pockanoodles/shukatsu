"use client";

import { useActionState, useEffect, useRef } from "react";
import { commentAction } from "@/app/actions/work";
import { Submit } from "./client";

export function CommentForm({ subject, path, labels }: { subject: string; path: string; labels: { placeholder: string; post: string; working: string } }) {
  const [state, action] = useActionState(commentAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  return (
    <form ref={form} action={action} className="grid gap-2">
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="path" value={path} />
      <label className="sr-only" htmlFor={`body-${subject}`}>{labels.placeholder}</label>
      <textarea id={`body-${subject}`} name="body" rows={2} required maxLength={4000} className="field" placeholder={labels.placeholder} />
      <div className="flex items-center gap-3">
        <Submit className="btn btn-ghost btn-sm" pending={labels.working}>{labels.post}</Submit>
        {state && !state.ok && <span role="alert" className="text-[13px] text-shu">{state.error}</span>}
      </div>
    </form>
  );
}
