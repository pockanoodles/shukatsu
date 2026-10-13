import "server-only";
import { engine } from "@/lib/server/engine";
import type { Activity } from "@/lib/types";

/** Give each activity a human name for its subject (fact text, packet company and role, posting host) instead of a raw id. */
export async function withLabels<T extends Pick<Activity, "subject">>(list: T[]): Promise<(T & { label?: string })[]> {
  const { root, review } = await engine();
  const labels: Record<string, string> = review.labelsFor(root, list.map((a) => a.subject));
  return list.map((a) => (a.subject && labels[a.subject] ? { ...a, label: labels[a.subject] } : a));
}
