import React from "react";
import type { Asset } from "../engine/types";
import { S, botBook, now } from "../engine/store";
import { claimable, perShareDividend, sweep, yieldAt, TAKER_FEE } from "../engine/market";
import { cancelOrder, cancelSubscription, confirmReceipt, dispute, marketBuy, marketSell, placeLimit, refund, run, subscribe } from "../engine/actions";
import { Seg, Meter } from "./ui";
import { EscrowTimeline } from "./EscrowTimeline";
import { ILock, ISpark, IShield, IChat, IClock } from "./icons";
import { tr } from "../lib/i18n";
import { countdown, price as fmtPrice, shares as fmtShares, usd, pct, usdCompact } from "../lib/format";
import { go } from "../lib/nav";

function periodWord(days: number) {
  return days <= 31 ? tr("每月", "a month") : days <= 95 ? tr("每季度", "a quarter") : tr(`每 ${days} 天`, `every ${days} days`);
}

function AmountInput({ value, onChange, unit, id }: { value: string; onChange: (v: string) => void; unit: string; id: string }) {
  return (
    <label className="amount" htmlFor={id}>
      <span className="unit">{unit === "USDT" ? "$" : ""}</span>
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label={unit} />
      <span className="unit">{unit}</span>
    </label>
  );
}

function Quote({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <div className="stack tight" style={{ fontSize: 13.5 }}>
      {rows.map(([k, v, cls]) => (
        <div className="spread" key={k}>
          <span className="muted">{k}</span>
          <span className={`num ${cls ?? ""}`} style={{ fontWeight: 650 }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TradePanel({ a, onDone }: { a: Asset; onDone?: () => void }) {
  const my = S.me.escrow.filter((e) => e.assetId === a.id && e.state !== "refunded" && e.state !== "confirmed");
  const t = now();

  return (
    <div className="card raised stack">
      {my.map((e) => (
        <div key={e.id} className="stack">
          <div className="spread">
            <h3>{tr("我的认购订单", "My subscription")}</h3>
            <span className="pill accent">
              <ILock /> {tr("资金托管中", "In escrow")}
            </span>
          </div>
          <EscrowTimeline a={a} e={e} compact />
          {a.offering.deliveredAt && e.state === "active" && (
            <div className="stack tight">
              <button className="btn primary block" onClick={() => run(() => confirmReceipt(e.id))}>
                {tr(`确认收货 · 领取 ${fmtShares(e.shares)} 份`, `Confirm receipt · get ${fmtShares(e.shares)} shares`)}
              </button>
              <button className="btn quiet sm" onClick={() => run(() => dispute(e.id, ""))}>
                {tr("登记有问题？申请仲裁", "Registry looks wrong? File a dispute")}
              </button>
            </div>
          )}
          {a.stage === "ipo" && (
            <button className="btn ghost sm" onClick={() => run(() => cancelSubscription(e.id))}>
              {tr("取消认购（全额退回）", "Cancel (full refund)")}
            </button>
          )}
          {a.stage === "failed" && (
            <button className="btn primary block" onClick={() => run(() => refund(e.id))}>
              {tr(`退回 ${usd(e.paid)}`, `Refund ${usd(e.paid)}`)}
            </button>
          )}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "4px 0", width: "100%" }} />
        </div>
      ))}

      {a.stage === "ipo" && <Subscribe a={a} onDone={onDone} />}
      {a.stage === "trading" && <Trade a={a} onDone={onDone} />}
      {a.stage === "qa" && (
        <div className="stack">
          <h3>{tr("公开问答期", "Public Q&A")}</h3>
          <p className="soft" style={{ fontSize: 14 }}>
            {a.qaEndsAt
              ? tr(`${countdown(a.qaEndsAt, t)}后开放认购。现在是提问的最好时机：商户必须在 72 小时内公开回答，问答会归档进发行文件。`, `The round opens in ${countdown(a.qaEndsAt, t)}. Now is the time to ask: the merchant must answer publicly within 72 hours, and answers are filed with the offering.`)
              : tr("商户回答完所有问题后开放认购。", "The round opens once the merchant has answered every question.")}
          </p>
          <button className="btn primary block" onClick={() => document.getElementById("tab-qa")?.click()}>
            <IChat /> {tr("去提问", "Ask a question")}
          </button>
        </div>
      )}
      {a.stage === "settling" && my.length === 0 && (
        <div className="stack">
          <h3>{tr("交割中", "Settling")}</h3>
          <p className="soft" style={{ fontSize: 14 }}>
            {tr("这一轮已成团。商户签约、平台核验登记变更后开放交易。", "This round filled. Trading opens after the merchant signs and the platform verifies the registry change.")}
          </p>
        </div>
      )}
      {a.stage === "review" && (
        <div className="stack">
          <h3>{tr("AI 尽调中", "AI review in progress")}</h3>
          <p className="soft" style={{ fontSize: 14 }}>{tr("审核通过后进入公开问答期，任何人都可以提问。", "After the review, a public Q&A opens where anyone can ask.")}</p>
        </div>
      )}
      {a.stage === "failed" && my.length === 0 && (
        <div className="callout bad">
          <IClock />
          <span>{tr("这一轮未成功，所有托管资金已可全额退回。", "This round did not complete; all escrowed funds are refundable.")}</span>
        </div>
      )}
    </div>
  );
}

function Subscribe({ a, onDone }: { a: Asset; onDone?: () => void }) {
  const [amt, setAmt] = React.useState("100");
  const o = a.offering;
  const v = Number(amt) || 0;
  const target = o.sharesForSale * o.price;
  const sharesOut = Math.min(v / o.price, o.sharesForSale - o.sold);
  const pctOfCompany = (sharesOut / o.sharesForSale) * a.companyPct;
  const perPeriod = sharesOut * perShareDividend(a);
  const t = now();
  return (
    <div className="stack">
      <div className="spread">
        <h3>{tr("首发认购", "Launch round")}</h3>
        <span className="muted num" style={{ fontSize: 13 }}>
          {tr("统一价", "Fixed price")} {fmtPrice(o.price)}
        </span>
      </div>
      <div className="stack tight">
        <Meter value={o.raised / target} />
        <div className="spread muted" style={{ fontSize: 12.5 }}>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>{usdCompact(o.raised)}</b> / {usdCompact(target)} · {tr("最低成团", "min")} {usdCompact(o.minRaise)}
          </span>
          <span>{countdown(o.deadline, t)}</span>
        </div>
      </div>
      <AmountInput id={`sub-${a.id}`} value={amt} onChange={setAmt} unit="USDT" />
      <div className="presets">
        {[10, 50, 100, 500].map((x) => (
          <button key={x} onClick={() => setAmt(String(x))}>
            ${x}
          </button>
        ))}
      </div>
      <Quote
        rows={[
          [tr("获得份额", "You get"), `${fmtShares(sharesOut)} ${tr("份", "shares")}`],
          [a.instrument === "equity" ? tr("相当于公司股权", "Equal to company equity") : tr("相当于收入权益", "Share of the stream"), `${pctOfCompany.toFixed(pctOfCompany < 0.01 ? 4 : 3)}%`],
          [tr(`预计分红（${periodWord(a.commitment.periodDays)}）`, `Dividend (${periodWord(a.commitment.periodDays)})`), usd(perPeriod), "gold"],
          [tr("承诺年化", "Promised yield"), pct(yieldAt(a, o.price)), "gold"],
        ]}
      />
      <div className="callout">
        <IShield />
        <span style={{ fontSize: 13 }}>
          {tr(
            "USDT 锁在托管合约里，平台和商户都动不了。成团 → 商户签约并完成工商变更 → 你确认收货，钱才放给商户。没成团或商户没交割，全额退回。",
            "Your USDT is locked in an escrow contract that neither the platform nor the merchant can touch. Round fills → merchant signs and registers the transfer → you confirm receipt, and only then is the merchant paid. If not, you get every cent back.",
          )}
        </span>
      </div>
      <button
        className="btn primary lg block"
        disabled={!v || v > S.me.usdt}
        onClick={() => {
          if (run(() => subscribe(a.id, v))) onDone?.();
        }}
      >
        {v > S.me.usdt ? tr("USDT 余额不足", "Not enough USDT") : tr(`认购 ${usd(v)}`, `Subscribe ${usd(v)}`)}
      </button>
      {v > S.me.usdt && (
        <button className="btn quiet sm" onClick={() => go("me")}>
          {tr("去领取测试 USDT", "Get test USDT")}
        </button>
      )}
    </div>
  );
}

function Trade({ a, onDone }: { a: Asset; onDone?: () => void }) {
  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [kind, setKind] = React.useState<"market" | "limit">("market");
  const [amt, setAmt] = React.useState("50");
  const [limitPx, setLimitPx] = React.useState(a.price.toFixed(2));
  const [size, setSize] = React.useState("100");
  const p = S.me.positions[a.id];
  const free = p ? p.shares - p.locked : 0;
  const book = botBook(a);
  const v = Number(amt) || 0;
  const q =
    kind === "market"
      ? side === "buy"
        ? sweep(book.asks, { budget: v, side: "buy" })
        : sweep(book.bids, { maxShares: Math.min(v, free), side: "sell" })
      : null;
  const myOrders = S.me.orders.filter((o) => o.assetId === a.id);
  const dividendPerShare = perShareDividend(a);

  return (
    <div className="stack">
      <div className="spread">
        <Seg
          className="buy"
          value={side}
          onChange={(s) => {
            setSide(s);
            setAmt(s === "buy" ? "50" : String(Math.floor(free * 100) / 100 || ""));
          }}
          items={[
            { id: "buy", label: tr("买入", "Buy"), cls: "b" },
            { id: "sell", label: tr("卖出", "Sell"), cls: "s" },
          ]}
        />
        <Seg
          value={kind}
          onChange={setKind}
          items={[
            { id: "market", label: tr("市价", "Market") },
            { id: "limit", label: tr("限价", "Limit") },
          ]}
        />
      </div>

      {kind === "market" ? (
        <>
          <AmountInput id={`amt-${a.id}`} value={amt} onChange={setAmt} unit={side === "buy" ? "USDT" : tr("份", "shares")} />
          <div className="presets">
            {side === "buy"
              ? [10, 50, 100, 500].map((x) => (
                  <button key={x} onClick={() => setAmt(String(x))}>
                    ${x}
                  </button>
                ))
              : [0.25, 0.5, 0.75, 1].map((f) => (
                  <button key={f} onClick={() => setAmt(String(Math.floor(free * f * 100) / 100))}>
                    {f === 1 ? tr("全部", "All") : `${f * 100}%`}
                  </button>
                ))}
          </div>
          {q && q.size > 0 && (
            <Quote
              rows={
                side === "buy"
                  ? [
                      [tr("预计获得", "You get"), `${fmtShares(q.size)} ${tr("份", "shares")}`],
                      [tr("成交均价", "Average price"), fmtPrice(q.avgPrice)],
                      [tr("手续费 0.5%", "Fee 0.5%"), usd(q.fee)],
                      [tr(`预计分红（${periodWord(a.commitment.periodDays)}）`, `Dividend (${periodWord(a.commitment.periodDays)})`), usd(q.size * dividendPerShare), "gold"],
                    ]
                  : [
                      [tr("预计到手", "You receive"), usd(q.cost - q.fee)],
                      [tr("成交均价", "Average price"), fmtPrice(q.avgPrice)],
                      [tr("手续费 0.5%", "Fee 0.5%"), usd(q.fee)],
                    ]
              }
            />
          )}
          <button
            className={`btn lg block ${side === "buy" ? "up" : "down"}`}
            disabled={!v || (side === "buy" ? v > S.me.usdt : v > free + 1e-9)}
            onClick={() => {
              const ok = run(() => (side === "buy" ? marketBuy(a.id, v) : marketSell(a.id, v)));
              if (ok) onDone?.();
            }}
          >
            {side === "buy"
              ? v > S.me.usdt
                ? tr("USDT 余额不足", "Not enough USDT")
                : tr(`买入 ${usd(v)}`, `Buy ${usd(v)}`)
              : v > free + 1e-9
                ? tr("可卖份额不足", "Not enough shares")
                : tr(`卖出 ${fmtShares(v)} 份`, `Sell ${fmtShares(v)} shares`)}
          </button>
        </>
      ) : (
        <>
          <div className="two" style={{ gap: 8 }}>
            <label className="field">
              <span>{tr("价格 (USDT)", "Price (USDT)")}</span>
              <input className="input num" id={`lp-${a.id}`} inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label className="field">
              <span>{tr("数量（份）", "Size (shares)")}</span>
              <input className="input num" id={`ls-${a.id}`} inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          </div>
          <Quote
            rows={[
              [side === "buy" ? tr("最多花费", "Max cost") : tr("挂单总额", "Order value"), usd((Number(limitPx) || 0) * (Number(size) || 0) * (side === "buy" ? 1 + TAKER_FEE : 1))],
              [tr("当前价", "Last price"), fmtPrice(a.price)],
            ]}
          />
          <button
            className={`btn lg block ${side === "buy" ? "up" : "down"}`}
            onClick={() => run(() => placeLimit(a.id, side, Number(limitPx), Number(size)))}
            disabled={!Number(limitPx) || !Number(size)}
          >
            {side === "buy" ? tr("挂买单", "Place buy order") : tr("挂卖单", "Place sell order")}
          </button>
          <p className="muted" style={{ fontSize: 12 }}>
            {tr("挂卖单期间份额仍在你钱包里，继续拿分红；成交时才转出。", "While a sell order rests, the shares stay in your wallet and keep earning dividends until it fills.")}
          </p>
        </>
      )}

      {p && p.shares > 1e-9 && (
        <div className="kv sm">
          <div>
            <span className="k">{tr("持有", "Holding")}</span>
            <span className="v" style={{ fontSize: 15 }}>
              {fmtShares(p.shares)}
            </span>
          </div>
          <div>
            <span className="k">{tr("市值", "Value")}</span>
            <span className="v" style={{ fontSize: 15 }}>
              {usd(p.shares * a.price)}
            </span>
          </div>
          <div>
            <span className="k">{tr("待领分红", "Claimable")}</span>
            <span className="v gold" style={{ fontSize: 15 }}>
              {usd(claimable(p, a.dps))}
            </span>
          </div>
        </div>
      )}

      {myOrders.length > 0 && (
        <div className="stack tight">
          <span className="eyebrow">{tr("我的挂单", "My open orders")}</span>
          {myOrders.map((o) => (
            <div key={o.id} className="spread" style={{ fontSize: 13.5 }}>
              <span className={o.side === "buy" ? "up" : "down"} style={{ fontWeight: 700 }}>
                {o.side === "buy" ? tr("买", "Buy") : tr("卖", "Sell")}
              </span>
              <span className="num">
                {fmtShares(o.size - o.filled)} @ {fmtPrice(o.price)}
              </span>
              <button className="btn xs ghost" onClick={() => run(() => cancelOrder(o.id))}>
                {tr("撤单", "Cancel")}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row muted" style={{ fontSize: 12 }}>
        <ISpark size={14} /> {tr("链上订单簿 · 吃单手续费 0.5%，挂单免费", "On-chain order book · 0.5% taker fee, makers free")}
      </div>
    </div>
  );
}
