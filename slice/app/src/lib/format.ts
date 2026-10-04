import { lang, tr } from "./i18n";

const loc = () => (lang() === "zh" ? "zh-CN" : "en-US");

export function usd(n: number, digits?: number): string {
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  const s = Math.abs(n).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
  return (n < 0 ? "-$" : "$") + s;
}

/** $1.2M, $48K, $930 */
export function usdCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Share prices need more precision than balances. */
export function price(n: number): string {
  return "$" + n.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 });
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function shares(n: number): string {
  if (n >= 1000) return num(n, 0);
  if (n >= 10) return num(n, 2);
  return num(n, 4);
}

export function pct(n: number, digits = 1, signed = false): string {
  const s = (n * 100).toFixed(digits) + "%";
  return signed && n > 0 ? "+" + s : s;
}

export function date(t: number, withYear = true): string {
  return new Date(t).toLocaleDateString(loc(), {
    year: withYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  });
}

export function dateTime(t: number): string {
  return new Date(t).toLocaleString(loc(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "3天 4小时" / "3d 4h" until `t` from `now`. */
export function countdown(t: number, now: number): string {
  let ms = Math.max(0, t - now);
  const d = Math.floor(ms / DAY);
  ms -= d * DAY;
  const h = Math.floor(ms / HOUR);
  ms -= h * HOUR;
  const m = Math.floor(ms / MIN);
  if (d > 0) return tr(`${d}天 ${h}小时`, `${d}d ${h}h`);
  if (h > 0) return tr(`${h}小时 ${m}分`, `${h}h ${m}m`);
  return tr(`${m}分钟`, `${m}m`);
}

export function ago(t: number, now: number): string {
  const ms = Math.max(0, now - t);
  if (ms < MIN) return tr("刚刚", "just now");
  if (ms < HOUR) return tr(`${Math.floor(ms / MIN)}分钟前`, `${Math.floor(ms / MIN)}m ago`);
  if (ms < DAY) return tr(`${Math.floor(ms / HOUR)}小时前`, `${Math.floor(ms / HOUR)}h ago`);
  const d = Math.floor(ms / DAY);
  if (d < 45) return tr(`${d}天前`, `${d}d ago`);
  return date(t);
}

export function shortHash(h: string | null | undefined): string {
  if (!h) return "—";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

export const TIME = { MIN, HOUR, DAY };
