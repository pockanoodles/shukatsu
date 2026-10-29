// The same count the server and the forms use: graphemes, line breaks included.
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;

export const countChars = (s: string) => { const t = s.replace(/\s+$/u, ""); if (!segmenter) return [...t].length; let n = 0; for (const _ of segmenter.segment(t)) n++; return n; };
export const countWords = (s: string) => (s.trim().match(/\S+/g) || []).length;
