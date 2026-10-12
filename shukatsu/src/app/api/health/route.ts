import { NextResponse } from "next/server";
import { engine } from "@/lib/server/engine";

export const dynamic = "force-dynamic";

/** Liveness: the engine loads and the data root is readable. Says nothing about the data. */
export async function GET() {
  try {
    await engine();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
