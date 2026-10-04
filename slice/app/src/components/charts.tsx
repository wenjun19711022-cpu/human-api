import React from "react";
import type { PricePoint } from "../engine/types";
import { date, dateTime, price as fmtPrice } from "../lib/format";

function niceTicks(min: number, max: number, count = 3): number[] {
  const span = max - min || max || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Single-series price line with area fill, recessive grid, endpoint marker and a hover crosshair. */
export function PriceChart({ points, up, intraday = false, height = 220 }: { points: PricePoint[]; up: boolean; intraday?: boolean; height?: number }) {
  const W = 640;
  const H = height;
  const pad = { l: 8, r: 52, t: 14, b: 22 };
  const ref = React.useRef<SVGSVGElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const gid = React.useId().replace(/:/g, "");

  if (points.length < 2) return null;
  const ps = points.map((p) => p.p);
  let min = Math.min(...ps);
  let max = Math.max(...ps);
  const padY = (max - min) * 0.12 || max * 0.02;
  min -= padY;
  max += padY;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
  const area = `${line}L${x(t1).toFixed(1)},${H - pad.b}L${x(t0).toFixed(1)},${H - pad.b}Z`;
  const color = up ? "var(--up)" : "var(--down)";
  const ticks = niceTicks(min, max, 3);
  const last = points[points.length - 1];

  const onMove = (clientX: number) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.t) - sx);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart-wrap">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="price chart"
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={W - pad.r + 8} y={y(v)} dominantBaseline="central" fontSize={11} fill="var(--ink-3)">
              {fmtPrice(v)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} fontSize={11} fill="var(--ink-3)">
          {intraday ? dateTime(t0) : date(t0)}
        </text>
        <text x={W - pad.r} y={H - 4} fontSize={11} fill="var(--ink-3)" textAnchor="end">
          {intraday ? dateTime(t1) : date(t1)}
        </text>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(last.t)} cy={y(last.p)} r={4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(hp.t)} cy={y(hp.p)} r={5} fill={color} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(hp.t) / W) * 100}%`, top: `${(y(hp.p) / H) * 100}%` }}>
          <b>{fmtPrice(hp.p)}</b> · {intraday ? dateTime(hp.t) : date(hp.t)}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, up, width = 96, height = 32 }: { points: number[]; up: boolean; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const x = (i: number) => (i / (points.length - 1)) * (width - 4) + 2;
  const y = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={2.5} fill={color} />
    </svg>
  );
}

/** Vertical bars with a per-bar hover tooltip. Colors come from tokens via `tone`. */
export function Bars({
  values,
  labels,
  tone,
  format,
  height = 150,
  hint,
}: {
  values: number[];
  labels: string[];
  tone?: (i: number) => string;
  format: (v: number) => string;
  height?: number;
  hint?: (i: number) => string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 4, r: 4, t: 10, b: 22 };
  const max = Math.max(...values, 1);
  const n = values.length;
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(4, Math.min(34, slot - 6));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const every = n > 14 ? Math.ceil(n / 8) : 1;
  return (
    <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="bar chart">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
        {values.map((v, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const top = y(v);
          const h = Math.max(v > 0 ? 2 : 0, H - pad.b - top);
          const r = Math.min(4, bw / 2, h);
          const left = cx - bw / 2;
          const d = h > 0 ? `M${left},${H - pad.b}V${top + r}Q${left},${top} ${left + r},${top}H${left + bw - r}Q${left + bw},${top} ${left + bw},${top + r}V${H - pad.b}Z` : "";
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {d && <path d={d} fill={tone ? tone(i) : "var(--accent)"} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {h === 0 && <rect x={left} y={H - pad.b - 2} width={bw} height={2} fill="var(--line)" />}
              {i % every === 0 && (
                <text x={cx} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--ink-3)">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%` }}>
          <b>{format(values[hover])}</b> · {hint ? hint(hover) : labels[hover]}
        </div>
      )}
    </div>
  );
}
