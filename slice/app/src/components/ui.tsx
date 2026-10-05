import React from "react";
import type { Asset, Audit, Category, Instrument, Stage } from "../engine/types";
import { CatIcon, ICheck, IClock, ISpark, IX, IAlert } from "./icons";
import { flag, COUNTRIES } from "../engine/geo";
import { l, tr } from "../lib/i18n";

export function Tile({ a, size }: { a: Pick<Asset, "symbol" | "hue" | "category">; size?: "lg" }) {
  const bg = `linear-gradient(140deg, hsl(${a.hue} 78% 56%), hsl(${(a.hue + 28) % 360} 70% 38%))`;
  const len = a.symbol.length;
  const fs = size === "lg" ? (len > 4 ? 18 : 22) : len > 4 ? 12 : 15;
  return (
    <div className={`tile ${size ?? ""}`} style={{ background: bg, fontSize: fs }} aria-hidden="true">
      {a.symbol}
      <CatIcon category={a.category} />
    </div>
  );
}

export function Flag({ code, label = false }: { code: string; label?: boolean }) {
  if (code === "AI") return null;
  return (
    <span title={l(COUNTRIES[code])} className="row" style={{ gap: 4, display: "inline-flex" }}>
      <span aria-hidden="true">{flag(code)}</span>
      {label && <span>{l(COUNTRIES[code]) || code}</span>}
    </span>
  );
}

export function gradeTone(score: number) {
  return score >= 75 ? "var(--up)" : score >= 60 ? "var(--warn)" : "var(--down)";
}

export function TrustRing({ audit, size = 40, showLabel = false }: { audit: Audit | null; size?: number; showLabel?: boolean }) {
  if (!audit) {
    return (
      <span className="pill accent">
        <ISpark /> {tr("AI 审核中", "AI reviewing")}
      </span>
    );
  }
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const color = gradeTone(audit.trustScore);
  return (
    <span className="trust" title={tr(`信任分 ${audit.trustScore}/100`, `Trust score ${audit.trustScore}/100`)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${audit.trustScore}/100`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * audit.trustScore) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="g" fill="var(--ink)" fontSize={size * 0.36}>
          {audit.grade}
        </text>
      </svg>
      {showLabel && (
        <span className="stack tight" style={{ gap: 0 }}>
          <b className="num" style={{ fontSize: 15 }}>
            {audit.trustScore}
            <span className="muted" style={{ fontSize: 12 }}>
              /100
            </span>
          </b>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {tr("AI 信任分", "AI trust score")}
          </span>
        </span>
      )}
    </span>
  );
}

export const STAGE_LABEL: Record<Stage, [string, string]> = {
  review: ["AI 审核中", "AI review"],
  qa: ["公开问答", "Public Q&A"],
  ipo: ["认购中", "Launch round"],
  settling: ["交割中", "Settling"],
  trading: ["交易中", "Trading"],
  failed: ["认购失败·可退款", "Failed · refundable"],
};

export function stageText(s: Stage) {
  return tr(...STAGE_LABEL[s]);
}

export function StagePill({ a }: { a: Asset }) {
  const tone = a.stage === "ipo" ? "accent" : a.stage === "trading" ? "" : a.stage === "failed" ? "down" : a.stage === "qa" ? "warn" : "";
  const label = a.stage === "settling" && a.offering.deliveredAt ? tr("待确认收货", "Confirming") : stageText(a.stage);
  return <span className={`pill ${tone}`}>{label}</span>;
}

export const INSTRUMENT: Record<Instrument, [string, string]> = {
  equity: ["股权", "Equity"],
  dividend_rights: ["分红权", "Dividend rights"],
  revenue_share: ["收入分成", "Revenue share"],
};

export const CATEGORY: Record<Category, [string, string]> = {
  bar: ["酒吧", "Bars"],
  restaurant: ["餐厅", "Restaurants"],
  cafe: ["咖啡", "Cafés"],
  teashop: ["茶饮", "Tea shops"],
  music: ["音乐版权", "Music royalties"],
  ecommerce: ["电商", "E-commerce"],
  game: ["游戏", "Games"],
  creator: ["创作者", "Creators"],
  energy: ["能源", "Energy"],
  hotel: ["民宿酒店", "Stays"],
  carwash: ["洗车", "Car washes"],
  ev: ["充电站", "EV charging"],
};

const STAGES: Stage[] = ["review", "qa", "ipo", "settling", "trading"];
const STEP_LABEL: [string, string][] = [
  ["AI 审核", "AI review"],
  ["公开问答", "Q&A"],
  ["认购", "Round"],
  ["交割", "Settle"],
  ["交易", "Trading"],
];

export function Stepper({ a }: { a: Asset }) {
  const idx = a.stage === "failed" ? 2 : STAGES.indexOf(a.stage);
  return (
    <div className="stepper" aria-label={tr("上链进度", "Listing progress")}>
      {STAGES.map((s, i) => (
        <div key={s} className={`st ${i < idx ? "done" : i === idx ? "now" : ""}`}>
          <i />
          <span>{tr(...STEP_LABEL[i])}</span>
        </div>
      ))}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "gold" | "up" }) {
  return (
    <div className={`meter ${tone ?? ""}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function StatusDot({ s }: { s: "pass" | "warn" | "fail" | "unknown" | "info" | "run" }) {
  return (
    <span className={`status-dot ${s}`}>
      {s === "pass" ? <ICheck /> : s === "fail" ? <IX /> : s === "run" ? <IClock /> : s === "warn" ? <IAlert /> : <IClock />}
    </span>
  );
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number; alert?: boolean }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className={`count ${it.alert ? "alert" : ""}`}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; cls?: string }[]; className?: string }) {
  return (
    <div className={`seg ${className ?? ""}`}>
      {items.map((it) => (
        <button key={it.id} className={it.cls} aria-pressed={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <b style={{ color: "var(--ink)" }}>{title}</b>
      {children}
    </div>
  );
}

export function Delta({ v, digits = 1 }: { v: number; digits?: number }) {
  const cls = v > 0.00005 ? "up" : v < -0.00005 ? "down" : "muted";
  return (
    <span className={`num ${cls}`} style={{ fontWeight: 700 }}>
      {v > 0 ? "▲" : v < 0 ? "▼" : ""} {(Math.abs(v) * 100).toFixed(digits)}%
    </span>
  );
}
