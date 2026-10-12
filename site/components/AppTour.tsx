"use client";

// The app, four screens of it, in the visitor's language and theme. The tabs
// are the app's own segmented pills (.seg), and the frame is a ruled figure
// like the app's. Every image is the app running on the repo's made-up test
// candidate (`npm run shots`), never a real record.
import { useState } from "react";
import type { Dict, Locale, ShotId } from "@/content/copy";
import { asset } from "@/app/_lib/base";

const ORDER: ShotId[] = ["today", "review", "record", "packet"];

export function AppTour({ t, locale }: { t: Dict["app"]; locale: Locale }) {
  const [active, setActive] = useState<ShotId>("review");
  const shot = t.shots[active];
  const src = (theme: "light" | "dark", id: ShotId) => asset(`/shots/${locale}/${theme}/${id}.webp`);

  // Arrow keys move between tabs, as a tablist should.
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = ORDER[(ORDER.indexOf(active) + step + ORDER.length) % ORDER.length];
    setActive(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <div className="tour">
      <div className="seg tour__tabs" role="tablist" aria-label={t.eyebrow} onKeyDown={onKey}>
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={active === id}
            aria-controls="tour-panel"
            tabIndex={active === id ? 0 : -1}
            className={active === id ? "on" : undefined}
            onClick={() => setActive(id)}
          >
            {t.shots[id].tab}
          </button>
        ))}
      </div>
      <figure id="tour-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="tour__frame">
        <div className="tour__shot">
          {ORDER.map((id) => (
            // All four load up front so switching never waits on the network;
            // the inactive ones are hidden, which keeps the frame from jumping.
            <picture key={id} hidden={id !== active}>
              <source media="(prefers-color-scheme: dark)" srcSet={src("dark", id)} />
              <img
                src={src("light", id)}
                alt={t.shots[id].alt}
                width={2160}
                height={1350}
                loading={id === "review" ? "eager" : "lazy"}
                decoding="async"
              />
            </picture>
          ))}
        </div>
        <figcaption className="tour__caption">
          <span>{shot.caption}</span>
          <span className="label">{t.note}</span>
        </figcaption>
      </figure>
    </div>
  );
}
