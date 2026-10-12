import { Anton, IBM_Plex_Mono, IBM_Plex_Sans, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";

// The app's voices (../shukatsu/src/app/layout.tsx), declared again here
// because next/font runs per app. Keep the two lists the same: the shared
// Ledger parts (generated/ledger.css) name these five variables. next/font
// self-hosts them at build time, so the page makes no font request to anyone.
export const display = Anton({ variable: "--font-display", weight: "400", subsets: ["latin"] });
export const body = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
export const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "700"] });
export const displayJa = Shippori_Mincho({ variable: "--font-display-ja", weight: "800", subsets: ["latin"], preload: false });
export const bodyJa = Zen_Kaku_Gothic_New({ variable: "--font-body-ja", weight: ["400", "500", "700"], subsets: ["latin"], preload: false });

export const fontVars = `${display.variable} ${body.variable} ${mono.variable} ${displayJa.variable} ${bodyJa.variable}`;
