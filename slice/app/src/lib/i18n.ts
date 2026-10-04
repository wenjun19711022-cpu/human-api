import type { L, Lang } from "../engine/types";

let current: Lang = "zh";

export function setLang(lang: Lang) {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

export function lang(): Lang {
  return current;
}

/** Inline bilingual string: tr("市场", "Market"). */
export function tr(zh: string, en: string): string {
  return current === "zh" ? zh : en;
}

/** Pick the current language from a bilingual value. */
export function l(v: L | undefined | null): string {
  if (!v) return "";
  return v[current] || v.zh || v.en;
}

export const L_ = (zh: string, en: string): L => ({ zh, en });
