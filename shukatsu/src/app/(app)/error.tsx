"use client";

/** Shown when a page in the app throws. The message is the engine's, since it says what to fix. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ja = typeof document !== "undefined" && document.documentElement.lang === "ja";
  return (
    <div className="grid gap-5 px-4 py-14 sm:px-10">
      <span className="stamp lg" aria-hidden>止</span>
      <h1 className="display text-[40px]">{ja ? "問題が発生しました" : "Something broke"}</h1>
      <p className="max-w-2xl whitespace-pre-line text-ink-2">{error.message || (ja ? "もう一度お試しください。" : "Try again.")}</p>
      {error.digest && <p className="code text-ink-3">{error.digest}</p>}
      <button type="button" onClick={reset} className="btn justify-self-start">{ja ? "もう一度" : "Try again"}</button>
    </div>
  );
}
