import React from "react";
import { ui, type UiEvent } from "../engine/store";
import { BADGES, LEVEL_NAMES } from "../engine/ops";
import { l, tr } from "../lib/i18n";

interface Toast {
  id: number;
  text: string;
  tone: string;
}

const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function burst(canvas: HTMLCanvasElement, gold: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = gold
    ? [css.getPropertyValue("--gold"), "#ffd76a", "#f5b83d"]
    : [css.getPropertyValue("--accent"), css.getPropertyValue("--gold"), css.getPropertyValue("--up"), "#ff8fa3"];
  const parts = Array.from({ length: gold ? 70 : 120 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.42,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    r: Math.random() * 360,
    vr: (Math.random() - 0.5) * 20,
    s: 5 + Math.random() * 6,
    c: colors[Math.floor(Math.random() * colors.length)].trim() || "#f5b83d",
    round: gold || Math.random() < 0.3,
  }));
  let frame = 0;
  const tick = () => {
    frame++;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.42;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.r * Math.PI) / 180);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - frame / 110);
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (frame < 110) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(tick);
}

export function Effects() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [coin, setCoin] = React.useState<{ id: number; amount: number } | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(
    () =>
      ui.on((e: UiEvent) => {
        const push = (text: string, tone: string) => {
          const id = Date.now() + Math.random();
          setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
          setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3600);
        };
        if (e.type === "toast") push(e.text, e.tone ?? "info");
        if (e.type === "confetti" && canvas.current && !reduced()) burst(canvas.current, false);
        if (e.type === "coins") {
          setCoin({ id: Date.now(), amount: e.amount });
          if (canvas.current && !reduced()) burst(canvas.current, true);
          setTimeout(() => setCoin(null), 1500);
        }
        if (e.type === "badge") {
          const b = BADGES[e.id];
          if (b) push(tr(`解锁徽章「${l(b.name)}」+XP`, `Badge unlocked: ${l(b.name)}`), "good");
        }
        if (e.type === "level") push(tr(`升级！你现在是 Lv.${e.level + 1}「${l(LEVEL_NAMES[e.level])}」`, `Level up! You're now Lv.${e.level + 1} ${l(LEVEL_NAMES[e.level])}`), "good");
      }),
    [],
  );

  return (
    <>
      <canvas ref={canvas} className="fx" aria-hidden="true" />
      {coin && (
        <div className="coinpop num" key={coin.id} aria-live="polite">
          +${coin.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <i />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
