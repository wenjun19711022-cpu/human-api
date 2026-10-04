import React from "react";
import type { Asset } from "../engine/types";
import { S, getAsset, now, useWorld } from "../engine/store";
import { Flag, Sheet, StagePill, Stepper, Tabs, Tile, TrustRing, CATEGORY, INSTRUMENT, Delta } from "../components/ui";
import { PriceChart } from "../components/charts";
import { TradePanel } from "../components/TradePanel";
import { AuditView, CommitmentView, ConfidenceCard, DocsList, OrderBookView, Overview, QA } from "../components/AssetParts";
import { IBack } from "../components/icons";
import { l, tr } from "../lib/i18n";
import { countdown, date, price as fmtPrice, usd, usdCompact, pct, TIME } from "../lib/format";
import { change, dueDate, impliedValuation, record, yieldAt } from "../engine/market";
import { go } from "../lib/nav";

type Tab = "overview" | "audit" | "qa" | "dividends" | "book" | "docs";
type Range = "1D" | "1W" | "1M" | "ALL";

export function AssetPage({ id }: { id: string }) {
  useWorld();
  const a = getAsset(id);
  const [tab, setTab] = React.useState<Tab>("overview");
  const [range, setRange] = React.useState<Range>("1M");
  const [sheet, setSheet] = React.useState(false);
  if (!a) {
    return (
      <div className="card empty">
        <b>{tr("没有找到这个资产", "Asset not found")}</b>
        <button className="btn ghost" onClick={() => go("market")}>
          {tr("回到市场", "Back to market")}
        </button>
      </div>
    );
  }
  const t = now();
  const all = a.history.concat(a.intraday.filter((p) => p.t > (a.history[a.history.length - 1]?.t ?? 0)));
  const windowMs = range === "1D" ? TIME.DAY : range === "1W" ? 7 * TIME.DAY : range === "1M" ? 30 * TIME.DAY : Infinity;
  const pts = range === "1D" ? a.intraday.filter((p) => p.t >= t - TIME.DAY) : all.filter((p) => p.t >= t - windowMs);
  const shown = pts.length >= 2 ? pts.concat(pts[pts.length - 1].t < t ? [{ t, p: a.price }] : []) : all.slice(-2);
  const ch = change(all, t, windowMs === Infinity ? t - all[0].t : windowMs, a.price);
  const rec = record(a.commitment);
  const next = a.commitment.status.indexOf("pending");
  const open = a.qa.filter((q) => !q.answer).length;
  const myEscrow = S.me.escrow.some((e) => e.assetId === a.id && e.state === "active");

  return (
    <>
      <div className="row">
        <button className="btn quiet sm" onClick={() => (history.length > 1 ? history.back() : go("market"))}>
          <IBack /> {tr("返回", "Back")}
        </button>
      </div>
      <div className="asset-layout">
        <div className="stack loose" style={{ minWidth: 0 }}>
          <div className="asset-head">
            <Tile a={a} size="lg" />
            <div className="stack tight" style={{ minWidth: 0 }}>
              <div className="row wrap">
                <h1>{a.name}</h1>
              </div>
              <div className="row wrap muted" style={{ fontSize: 13.5 }}>
                <Flag code={a.country} /> {l(a.city)} · {tr(...CATEGORY[a.category])} · {tr(...INSTRUMENT[a.instrument])} {a.companyPct}% · <span className="mono">{a.symbol}</span>
              </div>
              <div className="row wrap">
                <StagePill a={a} />
                <TrustRing audit={a.audit} size={30} showLabel />
              </div>
            </div>
          </div>
          <Stepper a={a} />

          {a.stage === "trading" ? (
            <div className="card stack">
              <div className="spread wrap">
                <div className="stack tight">
                  <span className="big-price" style={{ fontSize: 36 }}>
                    {fmtPrice(a.price)}
                  </span>
                  <span className="row" style={{ fontSize: 13.5 }}>
                    <Delta v={ch} digits={2} /> <span className="muted">{range === "ALL" ? tr("上市以来", "since listing") : range}</span>
                  </span>
                </div>
                <div className="seg">
                  {(["1D", "1W", "1M", "ALL"] as Range[]).map((r) => (
                    <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {r === "ALL" ? tr("全部", "All") : r}
                    </button>
                  ))}
                </div>
              </div>
              <PriceChart points={shown} up={ch >= 0} intraday={range === "1D"} />
            </div>
          ) : null}

          <div className="kv">
            <div>
              <span className="k">{tr("承诺年化", "Promised yield")}</span>
              <span className="v gold">{pct(yieldAt(a, a.stage === "trading" ? a.price : a.offering.price))}</span>
              <span className="s">{tr(`按${a.stage === "trading" ? "现价" : "首发价"}`, `at ${a.stage === "trading" ? "last" : "launch"} price`)}</span>
            </div>
            <div>
              <span className="k">{tr("下次分红", "Next dividend")}</span>
              <span className="v">{next === -1 ? "—" : date(dueDate(a.commitment, next), false)}</span>
              <span className="s">{next === -1 || !a.commitment.firstDue ? "" : t < dueDate(a.commitment, next) ? countdown(dueDate(a.commitment, next), t) : tr("宽限期", "grace period")}</span>
            </div>
            <div>
              <span className="k">{tr("保证金", "Bond")}</span>
              <span className="v">{usdCompact(a.commitment.bond)}</span>
              <span className="s">{tr("违约自动赔付", "pays holders on default")}</span>
            </div>
            <div>
              <span className="k">{a.instrument === "equity" ? tr("隐含公司估值", "Implied valuation") : tr("票据总值", "Note value")}</span>
              <span className="v">{usdCompact(impliedValuation(a))}</span>
              <span className="s">{a.instrument === "equity" ? tr(`${a.companyPct}% 对外`, `${a.companyPct}% sold`) : tr(`${a.companyPct}% 收入`, `${a.companyPct}% of revenue`)}</span>
            </div>
            <div>
              <span className="k">{tr("履约", "Record")}</span>
              <span className={`v ${rec.defaulted ? "down" : ""}`}>{rec.settled ? `${rec.paid}/${rec.settled}` : "—"}</span>
              <span className="s">{rec.defaulted ? tr(`${rec.defaulted} 次违约`, `${rec.defaulted} default`) : tr("按时期数", "on time")}</span>
            </div>
            <div>
              <span className="k">{tr("持有人", "Holders")}</span>
              <span className="v">{Math.max(a.holders, a.offering.investors).toLocaleString()}</span>
              <span className="s">{a.stage === "trading" ? tr(`24h 成交 ${usdCompact(a.volume24h)}`, `24h vol ${usdCompact(a.volume24h)}`) : ""}</span>
            </div>
          </div>

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: "overview", label: tr("概览", "Overview") },
              { id: "audit", label: tr("AI 尽调", "AI report") },
              { id: "qa", label: tr("问答", "Q&A"), count: open || a.qa.length, alert: open > 0 },
              { id: "dividends", label: tr("分红承诺", "Dividends") },
              ...(a.stage === "trading" ? [{ id: "book" as Tab, label: tr("订单簿", "Order book") }] : []),
              { id: "docs", label: tr("文件", "Documents"), count: a.docs.length },
            ]}
          />
          {/* hidden helper so the trade ticket can jump to Q&A */}
          <button id="tab-qa" className="sr" onClick={() => setTab("qa")}>
            Q&A
          </button>
          {tab === "overview" && <Overview a={a} />}
          {tab === "audit" && <AuditView a={a} />}
          {tab === "qa" && <QA a={a} />}
          {tab === "dividends" && <CommitmentView a={a} />}
          {tab === "book" && <OrderBookView a={a} />}
          {tab === "docs" && <DocsList a={a} />}
        </div>

        <aside className="ticket desktop-only">
          <TradePanel a={a} />
          <ConfidenceCard a={a} />
        </aside>
      </div>

      <div className="cta-spacer" />
      <MobileCta a={a} onOpen={() => setSheet(true)} highlight={myEscrow} />
      <Sheet open={sheet} onClose={() => setSheet(false)} label={a.name}>
        <TradePanel a={a} onDone={() => setSheet(false)} />
        <ConfidenceCard a={a} />
      </Sheet>
    </>
  );
}

function MobileCta({ a, onOpen, highlight }: { a: Asset; onOpen: () => void; highlight: boolean }) {
  const label =
    highlight && a.offering.deliveredAt
      ? tr("确认收货", "Confirm receipt")
      : a.stage === "ipo"
        ? tr("认购", "Subscribe")
        : a.stage === "trading"
          ? tr("买入 / 卖出", "Buy / Sell")
          : tr("查看", "Details");
  return (
    <div className="mobile-cta">
      <div className="grow stack tight" style={{ gap: 0 }}>
        <b className="num">{fmtPrice(a.stage === "trading" ? a.price : a.offering.price)}</b>
        <span className="muted" style={{ fontSize: 12 }}>
          {tr("余额", "Balance")} {usd(S.me.usdt)}
        </span>
      </div>
      <button className={`btn ${a.stage === "trading" ? "up" : "primary"}`} onClick={onOpen}>
        {label}
      </button>
    </div>
  );
}
