"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useFormStatus } from "react-dom";

// ---------------------------------------------------------------- theme

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const listeners = new Set<() => void>();
const readTheme = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};
function applyTheme(next: Theme) {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem("shk-theme");
    else localStorage.setItem("shk-theme", next);
  } catch {}
  listeners.forEach((l) => l());
}

export function ThemeToggle({ labels }: { labels: Record<Theme, string> & { switchTo: string } }) {
  const theme = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, readTheme, () => "system" as Theme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button type="button" onClick={() => applyTheme(next)} title={labels[theme]} aria-label={`${labels[theme]}. ${labels.switchTo.replace("{next}", labels[next].split(/[:：]\s*/).pop() || next)}`}
      className="grid h-11 w-11 place-items-center text-ink-2 hover:text-ink">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden>
        {theme === "light" && <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>}
        {theme === "dark" && <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />}
        {theme === "system" && <><rect x="3" y="4" width="18" height="12" /><path d="M8 20h8M12 16v4" /></>}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------- nav

export type NavItem = { href: string; label: string; badge?: number };

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  if (variant === "bottom") {
    return (
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t-2 rule bg-paper md:hidden">
        {items.map((it) => (
          <Link key={it.href} href={it.href} aria-current={active(it.href) ? "page" : undefined}
            className={`relative flex min-h-[56px] min-w-[76px] flex-1 flex-col items-center justify-center gap-0.5 px-2 ${active(it.href) ? "bg-ink text-on-ink" : "text-ink-2"}`}>
            <span className="label text-[11px]">{it.label}</span>
            {it.badge ? <span className={`code text-[11px] ${active(it.href) ? "" : "text-shu"}`}>{it.badge}</span> : null}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Primary" className="hidden items-stretch md:flex">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={active(it.href) ? "page" : undefined}
          className={`label flex items-center gap-2 px-3.5 ${active(it.href) ? "bg-ink text-on-ink" : "text-ink-2 hover:text-ink"}`}>
          {it.label}
          {it.badge ? <span className={`grid min-w-5 place-items-center px-1 text-[11px] ${active(it.href) ? "bg-on-ink text-ink" : "bg-shu text-on-shu"}`}>{it.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- forms

export function Submit({ children, className = "btn", pending, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={busy || rest.disabled} aria-busy={busy} {...rest}>
      {busy && pending ? pending : children}
    </button>
  );
}

export function CopyButton({ text, label, done, className = "btn btn-ghost btn-sm" }: { text: string; label: string; done: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
    }}>{copied ? done : label}</button>
  );
}

/** Ask before a form that can't be undone easily submits. */
export function ConfirmSubmit({ children, message, className = "btn btn-ghost btn-sm" }: { children: React.ReactNode; message: string; className?: string }) {
  return <button type="submit" className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>;
}

// ---------------------------------------------------------------- live bullet editor

type LintResult = { findings: { severity: string; rule: string; message: string }[]; chars: number; max: number; added: string[]; removed: string[] };

/**
 * A wording field that shows, as you type, the bullet rules it breaks and the
 * figures it changes against the original. The server runs the same linter
 * the resume gate uses, so what passes here passes there.
 */
export function WordingField({ name, defaultValue, original, current = false, lint, labels, rows = 3, autoFocus = false, checkRules = true }: {
  name: string; defaultValue: string; original?: string | null; current?: boolean; rows?: number; autoFocus?: boolean; checkRules?: boolean;
  lint: (text: string, original: string | null, current: boolean) => Promise<LintResult>;
  labels: { chars: string; pass: string; figures: string };
}) {
  const [value, setValue] = useState(defaultValue);
  const [result, setResult] = useState<LintResult | null>(null);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => start(async () => setResult(await lint(value, original ?? null, current))), 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, original, current, lint]);
  const over = result && result.chars > result.max;
  return (
    <div className="grid gap-2">
      <textarea name={name} rows={rows} className="field" value={value} autoFocus={autoFocus} onChange={(e) => setValue(e.target.value)} />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="grid gap-1" aria-live="polite">
          {result && (result.added.length || result.removed.length) ? (
            <span className="label text-shu">{labels.figures.replace("{removed}", result.removed.join(", ") || "–").replace("{added}", result.added.join(", ") || "–")}</span>
          ) : null}
          {checkRules && result?.findings.map((f, i) => (
            <span key={i} className={`text-[13px] ${f.severity === "error" ? "text-shu" : "text-ink-2"}`}><span className="label mr-2">{f.rule}</span>{f.message}</span>
          ))}
          {checkRules && result && !result.findings.length ? <span className="label text-ink-2">{labels.pass}</span> : null}
        </div>
        {result && <span className={`label num ${over ? "text-shu" : "text-ink-3"}`}>{labels.chars.replace("{n}", String(result.chars)).replace("{max}", String(result.max))}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review keyboard

/** J/K between items; A/E/U/R trigger the matching control on the open item. */
export function ReviewKeys({ keys, current }: { keys: string[]; current: string | null }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        const i = current ? keys.indexOf(current) : -1;
        const next = keys[Math.min(keys.length - 1, Math.max(0, i + (k === "j" ? 1 : -1)))];
        if (next && next !== current) { const a = document.querySelector<HTMLAnchorElement>(`a[data-item="${CSS.escape(next)}"]`); a?.click(); }
        e.preventDefault();
        return;
      }
      const target = document.querySelector<HTMLElement>(`[data-key="${k}"]`);
      if (target) { target.click(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, current]);
  return null;
}

/** Disclosure that opens one outcome's form at a time (correct / narrative / reject). */
export function Outcomes({ children }: { children: React.ReactNode }) {
  return <div className="grid">{children}</div>;
}
