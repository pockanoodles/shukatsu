import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { engine } from "@/lib/server/engine";
import { getLang, getUser } from "@/lib/server/session";
import { translator } from "@/lib/i18n";
import { Bare } from "@/components/bare";
import { Stamp } from "@/components/marks";
import { approveOAuthAction, denyOAuthAction, reauthenticateAction } from "@/app/actions/oauth";
import { loadOAuth } from "../_oauth";

export const metadata: Metadata = { title: "Connect an app" };

type Agent = { id: number; name: string; disabled_at: string | null };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const request = sp.request || "";
  const lang = await getLang();
  const { t } = translator(lang);
  const { root, people } = await engine();
  const oauth = await loadOAuth();
  const pending = request ? await oauth.readPending(root, request) : null;
  const user = await getUser();
  if (pending && !user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?request=${encodeURIComponent(request)}`)}`);

  const back = `/oauth/consent?request=${encodeURIComponent(request)}`;
  const owner = user?.role === "owner";
  const fresh = Boolean(user && oauth.freshSession(user));
  const agents = (people.listAgents(root) as Agent[]).filter((a) => !a.disabled_at);
  const error = sp.error ? t(`oauth.err.${sp.error}`) : "";

  return (
    <Bare lang={lang} back={back}>
      <main className="grid flex-1 place-items-start px-4 py-12 sm:px-10">
        <div className="grid w-full max-w-xl gap-8">
          {!pending ? (
            <>
              <h1 className="display text-[40px]">{t("oauth.title")}</h1>
              <p className="border-l-4 border-shu pl-4 text-[17px]">{t("oauth.invalid")}</p>
            </>
          ) : !owner ? (
            <>
              <h1 className="display text-[40px]">{t("oauth.title")}</h1>
              <p className="border-l-4 border-shu pl-4 text-[17px]">{t("oauth.ownerOnly")}</p>
            </>
          ) : !fresh ? (
            <>
              <h1 className="display text-[40px]">{t("oauth.staleTitle")}</h1>
              <p className="text-[17px] text-ink-2">{t("oauth.staleLead")}</p>
              <form action={reauthenticateAction}>
                <input type="hidden" name="request" value={request} />
                <button type="submit" className="btn btn-shu">{t("oauth.staleSubmit")}</button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="display text-[44px] sm:text-[56px]">{t("oauth.title")}</h1>
                  <p className="mt-4 text-[17px] text-ink-2">{t("oauth.lead", { client: pending.client_name })}</p>
                </div>
                <Stamp tone="shu">接続</Stamp>
              </div>

              <dl className="grid gap-3 border-2 rule p-4">
                <div className="grid gap-1">
                  <dt className="label text-ink-3">{t("oauth.app")}</dt>
                  <dd className="heading text-[20px]">{pending.client_name}</dd>
                </div>
                {pending.client_host && (
                  <div className="grid gap-1">
                    <dt className="label text-ink-3">{t("oauth.publishedAt")}</dt>
                    <dd className="font-mono text-[14px]">{pending.client_host}</dd>
                  </div>
                )}
                <div className="grid gap-1">
                  <dt className="label text-ink-3">{t("oauth.returnsTo")}</dt>
                  <dd className="font-mono text-[14px]">{pending.redirect_host}{pending.redirect_loopback ? ` ${t("oauth.thisComputer")}` : ""}</dd>
                </div>
              </dl>

              <div className="grid gap-2">
                <h2 className="heading text-[18px]">{t("oauth.canTitle")}</h2>
                <p className="text-[15px] text-ink-2">{t("oauth.can")}</p>
                <p className="text-[15px] text-ink-2">{t("oauth.cannot")}</p>
              </div>

              {error && <p role="alert" className="border-l-4 border-shu pl-4 text-[15px]">{error}</p>}

              <form className="grid gap-5">
                <input type="hidden" name="request" value={request} />
                <fieldset className="grid gap-3">
                  <legend className="heading mb-1 text-[18px]">{t("oauth.identityTitle")}</legend>
                  <p className="text-[14px] text-ink-3">{t("oauth.identityHelp")}</p>
                  {agents.map((a, i) => (
                    <label key={a.id} className="flex items-center gap-3 border-2 rule p-3">
                      <input type="radio" name="agent" value={a.id} defaultChecked={i === 0} />
                      <span className="text-[16px]">{a.name}</span>
                    </label>
                  ))}
                  <label className="grid gap-2 border-2 rule p-3">
                    <span className="flex items-center gap-3">
                      <input type="radio" name="agent" value="new" defaultChecked={agents.length === 0} />
                      <span className="text-[16px]">{t("oauth.newIdentity")}</span>
                    </span>
                    <input name="name" className="field" maxLength={60} placeholder={pending.client_name} aria-label={t("oauth.newName")} />
                  </label>
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <button type="submit" formAction={approveOAuthAction} className="btn btn-shu">{t("oauth.approve")}</button>
                  <button type="submit" formAction={denyOAuthAction} className="btn btn-ghost">{t("oauth.deny")}</button>
                </div>
              </form>
            </>
          )}
        </div>
      </main>
    </Bare>
  );
}
