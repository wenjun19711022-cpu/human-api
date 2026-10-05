import React from "react";
import { S, now, useWorld } from "../engine/store";
import { claimable, dueDate, perShareDividend } from "../engine/market";
import { claimAll, run, setAutoReinvest } from "../engine/actions";
import { countriesOwned } from "../engine/ops";
import { COUNTRIES, flag } from "../engine/geo";
import { Empty, Flag, Meter, Switch, Tile } from "../components/ui";
import { Sparkline } from "../components/charts";
import { ICoin, IGlobe, IPie } from "../components/icons";
import { l, tr } from "../lib/i18n";
import { countdown, date, shares as fmtShares, usd, pct } from "../lib/format";
import { go } from "../lib/nav";

export function Portfolio() {
  useWorld();
  const t = now();
  const rows = S.assets
    .map((a) => ({ a, p: S.me.positions[a.id] }))
    .filter((x) => x.p && x.p.shares > 1e-9)
    .map(({ a, p }) => {
      const value = p!.shares * a.price;
      const next = a.commitment.status.indexOf("pending");
      return {
        a,
        p: p!,
        value,
        pnl: value - p!.cost,
        claim: claimable(p!, a.dps),
        nextDue: next === -1 ? null : dueDate(a.commitment, next),
        nextAmt: p!.shares * perShareDividend(a),
      };
    })
    .sort((x, y) => y.value - x.value);
  const posValue = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.p.cost, 0);
  const escrow = S.me.escrow.filter((e) => e.state === "active" || e.state === "disputed").reduce((s, e) => s + e.budget - e.withdrawn + (e.disputeBond ?? 0), 0);
  const orderEscrow = S.me.orders.reduce((s, o) => s + o.escrow, 0);
  const total = S.me.usdt + posValue + escrow + orderEscrow;
  const claimTotal = S.assets.reduce((s, a) => s + claimable(S.me.positions[a.id], a.dps), 0);
  const owned = new Set(countriesOwned());
  const allCountries = [...new Set(S.assets.map((a) => a.country))];
  const upcoming = rows.filter((r) => r.nextDue && r.nextDue > t).sort((x, y) => x.nextDue! - y.nextDue!);
  const maxVal = Math.max(...rows.map((r) => r.value), 1);

  return (
    <>
      <div className="two">
        <div className="card stack">
          <div className="balance">
            <span className="eyebrow">{tr("总资产", "Total value")}</span>
            <span className="v">{usd(total, 2)}</span>
            <span className={`num ${posValue - cost >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>
              {posValue - cost >= 0 ? "+" : ""}
              {usd(posValue - cost, 2)} ({cost ? pct((posValue - cost) / cost, 2, true) : "0%"}) <span className="muted" style={{ fontWeight: 500 }}>{tr("持仓盈亏", "on holdings")}</span>
            </span>
          </div>
          <div className="kv sm">
            <div>
              <span className="k">{tr("持仓市值", "Holdings")}</span>
              <span className="v" style={{ fontSize: 15 }}>
                {usd(posValue)}
              </span>
            </div>
            <div>
              <span className="k">{tr("托管中", "In escrow")}</span>
              <span className="v" style={{ fontSize: 15 }}>
                {usd(escrow + orderEscrow)}
              </span>
            </div>
            <div>
              <span className="k">USDT</span>
              <span className="v" style={{ fontSize: 15 }}>
                {usd(S.me.usdt)}
              </span>
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="claim">
            <div className="stack tight">
              <span className="eyebrow" style={{ color: "var(--gold)" }}>
                {tr("待领取分红", "Dividends to claim")}
              </span>
              <span className="big-price gold" style={{ fontSize: 30 }}>
                {usd(claimTotal, 2)}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {tr(`累计已领取 ${usd(S.me.claimedTotal, 2)}`, `${usd(S.me.claimedTotal, 2)} claimed so far`)}
              </span>
            </div>
            <button className="btn gold lg" disabled={claimTotal < 0.005} onClick={() => run(() => claimAll())}>
              <ICoin /> {tr("一键收租", "Collect")}
            </button>
            <div className="auto">
              <Switch on={S.me.autoReinvest} onChange={(v) => run(() => setAutoReinvest(v))} label={tr("分红自动复投", "Auto-reinvest dividends")} />
              <span className="grow stack tight" style={{ gap: 0 }}>
                <b>{tr("分红自动复投", "Auto-reinvest")}</b>
                <span className="muted" style={{ fontSize: 12 }}>
                  {S.me.autoReinvest
                    ? tr(`每笔分红到账，自动按卖一价买入同一门生意 · 已复投 ${usd(S.me.reinvested, 2)}`, `Each payout buys more of the same business at the best ask · ${usd(S.me.reinvested, 2)} reinvested`)
                    : tr("开启后，分红会自动买入更多份额，让收益滚雪球（ShareExchange.reinvest）", "Turn on to roll every payout into more shares (ShareExchange.reinvest)")}
                </span>
              </span>
            </div>
          </div>
          <div className="card stack">
            <div className="spread">
              <h3>{tr("我的生意版图", "My business passport")}</h3>
              <span className="muted num">
                {owned.size}/{allCountries.length}
              </span>
            </div>
            <div className="passport">
              {allCountries.map((c) => (
                <div key={c} className={`stamp ${owned.has(c) ? "got" : ""}`} title={l(COUNTRIES[c])}>
                  <span className="f" aria-hidden="true">
                    {flag(c)}
                  </span>
                  <span>{l(COUNTRIES[c])}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card flush">
        <div className="li">
          <h3 className="grow">{tr("持仓", "Holdings")}</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {rows.length} {tr("门生意", "businesses")}
          </span>
        </div>
        {rows.length === 0 ? (
          <Empty icon={<IPie />} title={tr("还没有持仓", "No holdings yet")}>
            <button className="btn primary sm" onClick={() => go("market")}>
              {tr("去市场看看", "Browse the market")}
            </button>
          </Empty>
        ) : (
          <div className="list">
            {rows.map((r) => (
              <button key={r.a.id} className="li clickable" onClick={() => go(`asset-${r.a.id}`)}>
                <Tile a={r.a} />
                <div className="grow stack tight" style={{ gap: 2 }}>
                  <b style={{ fontSize: 14.5 }}>{r.a.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {fmtShares(r.p.shares)} {tr("份", "shares")}
                    {r.p.locked > 0 ? tr(` · ${fmtShares(r.p.locked)} 挂单中`, ` · ${fmtShares(r.p.locked)} on order`) : ""}
                    {r.claim > 0.004 ? <b className="gold"> · {tr("待领", "claim")} {usd(r.claim, 2)}</b> : null}
                  </span>
                  <Meter value={r.value / maxVal} />
                </div>
                <span className="hide-sm">
                  <Sparkline points={r.a.history.slice(-30).map((x) => x.p).concat(r.a.price)} up={r.pnl >= 0} />
                </span>
                <div className="stack tight" style={{ gap: 0, textAlign: "right" }}>
                  <b className="num">{usd(r.value, 2)}</b>
                  <span className={`num ${r.pnl >= 0 ? "up" : "down"}`} style={{ fontSize: 12.5, fontWeight: 650 }}>
                    {r.pnl >= 0 ? "+" : ""}
                    {pct(r.p.cost ? r.pnl / r.p.cost : 0, 1)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card flush">
        <div className="li">
          <h3 className="grow">{tr("分红日历", "Dividend calendar")}</h3>
        </div>
        {upcoming.length === 0 ? (
          <Empty icon={<IGlobe />} title={tr("暂无即将到账的分红", "No upcoming payouts")} />
        ) : (
          <div className="list">
            {upcoming.map((r) => (
              <div key={r.a.id} className="li">
                <Flag code={r.a.country} />
                <div className="grow stack tight" style={{ gap: 0 }}>
                  <b style={{ fontSize: 14 }}>{r.a.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {date(r.nextDue!)} · {countdown(r.nextDue!, t)}
                  </span>
                </div>
                <b className="num gold">≈ {usd(r.nextAmt, 2)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
