// The base path every asset URL needs by hand (next.config.ts sets it for
// routes; a plain <img src> or an <a href> to a file does not get it).
export const BASE = "/shukatsu";
export const asset = (path: string) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
