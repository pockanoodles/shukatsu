import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { NextResponse } from "next/server";
import { engine } from "@/lib/server/engine";
import { getUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** The CV as markdown: the checked deliverable when there is one, else the draft without its fact tags. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user?.perms["view.review"]) return new NextResponse("Sign in first.", { status: 401 });
  const { id } = await params;
  const { root, packets } = await engine();
  const pk = packets.getPacketRow(root, Number(id));
  if (!pk) return new NextResponse("Not found.", { status: 404 });
  const paths = packets.packetPaths(root, pk);
  const file = paths.deliverable && existsSync(paths.deliverable) ? paths.deliverable : paths.draft;
  if (!file || !existsSync(file)) return new NextResponse("No CV yet.", { status: 404 });
  const text = readFileSync(file, "utf-8").split("\n").map((l) => l.replace(/\s*<!--\s*fact:[^>]*-->\s*$/, "")).join("\n");
  return new NextResponse(text, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${basename(file).replace(/\.final(?=\.md$)/, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
