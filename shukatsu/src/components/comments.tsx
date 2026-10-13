import { engine } from "@/lib/server/engine";
import { allowed, type User } from "@/lib/server/session";
import { relative, translator } from "@/lib/i18n";
import type { Comment } from "@/lib/types";
import { CommentThread } from "./comment-thread";

/** The conversation attached to one thing (a review item, a packet, a fact). */
export async function Comments({ subject, user, path }: { subject: string; user: User; path: string }) {
  const { t } = translator(user.lang);
  const { root, store } = await engine();
  const list: Comment[] = store.comments(root, subject);
  return (
    <CommentThread subject={subject} path={path} me={user.id} canComment={allowed(user, "comment")} canResolve={user.role === "owner"} title={t("comments.title")}
      comments={list.map((c) => ({
        id: c.id, parent_id: c.parent_id ?? null, author_id: c.author_id, author_name: c.author_name, role: t(`role.${c.author_role}`),
        when: relative(c.created_at, user.lang), body: c.body, resolved: Boolean(c.resolved_at),
      }))}
      l={{ placeholder: t("comments.placeholder"), reply: t("comments.reply"), post: t("comments.post"), resolve: t("comments.resolve"), resolved: t("comments.resolved"), cancel: t("common.cancel"), working: t("common.loading") }} />
  );
}
