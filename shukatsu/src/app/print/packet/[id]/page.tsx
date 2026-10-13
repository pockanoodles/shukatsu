import { readFileSync, existsSync } from "node:fs";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { engine } from "@/lib/server/engine";
import { requireCan } from "@/lib/server/session";
import { CvDocument } from "@/lib/cv-markdown";
import "./print.css";

export const metadata: Metadata = { title: "CV" };

/**
 * The CV as a page to print or save as PDF from the browser. Resume
 * conventions win over the app's look here: black on white, one column,
 * system serif-free type, nothing a parser could trip on.
 */
export default async function PrintPacket({ params }: { params: Promise<{ id: string }> }) {
  await requireCan("view.review");
  const { id } = await params;
  const { root, packets } = await engine();
  const pk = packets.getPacketRow(root, Number(id));
  if (!pk) notFound();
  const paths = packets.packetPaths(root, pk);
  const file = paths.deliverable && existsSync(paths.deliverable) ? paths.deliverable : paths.draft;
  if (!file || !existsSync(file)) notFound();
  return <CvDocument markdown={readFileSync(file, "utf-8")} />;
}
