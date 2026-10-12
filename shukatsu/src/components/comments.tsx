import { engine } from "@/lib/server/engine";
import { allowed, type User } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import type { Comment } from "@/lib/types";
import { resolveCommentAction } from "@/app/actions/work";
import { CommentForm } from "./comment-form";

/** The conversation attached to one thing (a review item, a packet, a fact). */
export async function Comments({ subject, user, path }: { subject: string; user: User; path: string }) {
  const { t } = translator(user.lang);
  const { root, store } = await engine();
  const list: Comment[] = store.comments(root, subject);
  const canComment = allowed(user, "comment");
  return (
    <section aria-labelledby={`c-${subject}`} className="grid gap-4">
      <h3 id={`c-${subject}`} className="label flex items-center gap-3 text-ink-2">{t("comments.title")}{list.length ? <span className="code text-ink">{list.length}</span> : null}</h3>
      {list.length === 0 && !canComment && <p className="text-[14px] text-ink-3">{t("comments.none")}</p>}
      <ol className="grid">
        {list.map((c) => (
          <li key={c.id} className={`grid gap-1 border-t hair py-3 ${c.resolved_at ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-bold">{c.author_name}</span>
              <span className="label text-ink-3">{t(`role.${c.author_role}`)} · {relative(c.created_at, user.lang)}</span>
              {c.resolved_at ? <span className="label text-ink-3">{t("comments.resolved")}</span> : (user.role === "owner" || user.id === c.author_id) && (
                <form action={resolveCommentAction} className="ml-auto">
                  <input type="hidden" name="id" value={c.id} /><input type="hidden" name="path" value={path} />
                  <button className="label text-ink-3 hover:text-ink">{t("comments.resolve")}</button>
                </form>
              )}
            </div>
            <p className="whitespace-pre-line text-[14.5px]">{c.body}</p>
          </li>
        ))}
      </ol>
      {canComment && <CommentForm subject={subject} path={path} labels={{ placeholder: t("comments.placeholder"), post: t("comments.post"), working: t("common.loading") }} />}
    </section>
  );
}
