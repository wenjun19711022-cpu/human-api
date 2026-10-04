import type { L, Person } from "./types";

export const COUNTRIES: Record<string, L> = {
  US: { zh: "美国", en: "United States" },
  JP: { zh: "日本", en: "Japan" },
  KR: { zh: "韩国", en: "South Korea" },
  CN: { zh: "中国", en: "China" },
  TW: { zh: "中国台湾", en: "Taiwan" },
  HK: { zh: "中国香港", en: "Hong Kong" },
  SG: { zh: "新加坡", en: "Singapore" },
  AU: { zh: "澳大利亚", en: "Australia" },
  KE: { zh: "肯尼亚", en: "Kenya" },
  NG: { zh: "尼日利亚", en: "Nigeria" },
  BR: { zh: "巴西", en: "Brazil" },
  AR: { zh: "阿根廷", en: "Argentina" },
  MX: { zh: "墨西哥", en: "Mexico" },
  DE: { zh: "德国", en: "Germany" },
  PL: { zh: "波兰", en: "Poland" },
  FR: { zh: "法国", en: "France" },
  GB: { zh: "英国", en: "United Kingdom" },
  TR: { zh: "土耳其", en: "Türkiye" },
  AE: { zh: "阿联酋", en: "UAE" },
  EG: { zh: "埃及", en: "Egypt" },
  IN: { zh: "印度", en: "India" },
  VN: { zh: "越南", en: "Vietnam" },
  ID: { zh: "印度尼西亚", en: "Indonesia" },
  TH: { zh: "泰国", en: "Thailand" },
  PH: { zh: "菲律宾", en: "Philippines" },
  CA: { zh: "加拿大", en: "Canada" },
};

/** Regional-indicator emoji flag from an ISO code. */
export function flag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Simulated investors from around the world. */
export const PEOPLE: Person[] = [
  { name: "Kenji", country: "JP" },
  { name: "Ada", country: "NG" },
  { name: "Lucas", country: "BR" },
  { name: "Lena", country: "DE" },
  { name: "Priya", country: "IN" },
  { name: "Sofía", country: "AR" },
  { name: "Emre", country: "TR" },
  { name: "Linh", country: "VN" },
  { name: "Putri", country: "ID" },
  { name: "Minjun", country: "KR" },
  { name: "Tyler", country: "US" },
  { name: "Olivia", country: "GB" },
  { name: "Chloé", country: "FR" },
  { name: "Omar", country: "EG" },
  { name: "Miguel", country: "PH" },
  { name: "Diego", country: "MX" },
  { name: "小雨", country: "CN" },
  { name: "Wei Ling", country: "SG" },
  { name: "Fatima", country: "AE" },
  { name: "Wanjiru", country: "KE" },
  { name: "Kasia", country: "PL" },
  { name: "Nok", country: "TH" },
  { name: "阿哲", country: "TW" },
  { name: "Noah", country: "CA" },
];

export const AI_AGENT: Person = { name: "AI 尽调官", country: "AI" };
