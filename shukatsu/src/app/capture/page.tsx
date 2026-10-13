import type { Metadata } from "next";
import { requireCan } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { Bare } from "@/components/bare";
import { CaptureForm } from "@/components/system-forms";

export const metadata: Metadata = { title: "Send to shukatsu" };

/** The window the "Send to shukatsu" bookmarklet opens. Signed in by the candidate's own session. */
export default async function CapturePage() {
  const user = await requireCan("posting.capture");
  const { t } = translator(user.lang);
  const keys = ["waiting", "from", "chars", "company", "role", "location", "note", "url", "text", "paste", "save", "saved", "replaced", "already", "close", "view", "untrusted"];
  return (
    <Bare lang={user.lang} back="/capture">
      <main className="grid flex-1 place-items-start px-4 py-8 sm:px-10">
        <div className="grid w-full max-w-2xl gap-6">
          <h1 className="display text-[40px]">{t("capture.title")}</h1>
          <CaptureForm l={{ ...Object.fromEntries(keys.map((k) => [k, t(`capture.${k}`)])), working: t("common.loading") }} />
        </div>
      </main>
    </Bare>
  );
}
