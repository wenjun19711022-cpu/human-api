import React from "react";
import type { Asset } from "../engine/types";
import { S, botBook, now } from "../engine/store";
import { CANCEL_CUTOFF_DAYS, allocation, claimable, perShareDividend, sweep, yieldAt, TAKER_FEE } from "../engine/market";
import {
  cancelOrder,
  cancelSubscription,
  confirmReceipt,
  dispute,
  disputeBondFor,
  marketBuy,
  marketSell,
  placeLimit,
  refund,
  reinvest,
  run,
  subscribe,
  withdrawUnfilled,
} from "../engine/actions";
import { orderView, roundView } from "../engine/view";
import { Seg, Meter } from "./ui";
import { Bars } from "./charts";
import { EscrowTimeline } from "./EscrowTimeline";
import { ILock, ISpark, IShield, IChat, IClock } from "./icons";
import { tr } from "../lib/i18n";
import { countdown, price as fmtPrice, shares as fmtShares, usd, pct, usdCompact, TIME } from "../lib/format";
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
      {my.map((e) => {
        const v = orderView(a, e);
        return (
          <div key={e.id} className="stack">
            <div className="spread">
              <h3>{tr("我的认购订单", "My subscription")}</h3>
              <span className="pill accent">
                <ILock /> {tr("资金托管中", "In escrow")} {usd(v.held)}
              </span>
            </div>
            <EscrowTimeline a={a} e={e} compact />
            {v.unfilled > 0.004 && (
              <button className="btn ghost sm" onClick={() => run(() => withdrawUnfilled(e.id))}>
                {tr(`取回未成交的 ${usd(v.unfilled)}`, `Withdraw ${usd(v.unfilled)} unfilled`)}
              </button>
            )}
            {a.offering.deliveredAt && e.state === "active" && v.shares > 0 && (
              <div className="stack tight">
                <button className="btn primary block" onClick={() => run(() => confirmReceipt(e.id))}>
                  {tr(`确认收货 · 领取 ${fmtShares(v.shares)} 份`, `Confirm receipt · get ${fmtShares(v.shares)} shares`)}
                </button>
                <button className="btn quiet sm" onClick={() => run(() => dispute(e.id, ""))}>
                  {tr(`登记有问题？申请仲裁（押金 ${usd(disputeBondFor(e.id))}）`, `Registry looks wrong? Dispute (bond ${usd(disputeBondFor(e.id))})`)}
                </button>
              </div>
            )}
            {a.stage === "ipo" && (
              <button
                className="btn ghost sm"
                disabled={t + CANCEL_CUTOFF_DAYS * TIME.DAY >= a.offering.deadline}
                onClick={() => run(() => cancelSubscription(e.id))}
              >
                {t + CANCEL_CUTOFF_DAYS * TIME.DAY >= a.offering.deadline
                  ? tr("截止前 48 小时不能撤单", "No cancelling in the final 48 hours")
                  : tr("取消认购（全额退回）", "Cancel (full refund)")}
              </button>
            )}
            {a.stage === "failed" && e.state === "active" && (
              <button className="btn primary block" onClick={() => run(() => refund(e.id))}>
                {tr(`退回 ${usd(v.held)}`, `Refund ${usd(v.held)}`)}
              </button>
            )}
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "4px 0", width: "100%" }} />
          </div>
        );
      })}

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

/** The order book of a launch round: committed USDT at each price on the ladder, clearing tick highlighted. */
export function DemandLadder({ a }: { a: Asset }) {
  const o = a.offering;
  const r = roundView(a);
  if (o.prices.length < 2) return null;
  return (
    <div className="stack tight">
      <div className="spread" style={{ fontSize: 12.5 }}>
        <span className="muted">{tr("认购簿：每个价位上的认购金额", "Round book: USDT committed at each price")}</span>
        <span className="pill accent">
          {tr("预计清算价", "Clearing now")} {fmtPrice(r.clearing.price)}
        </span>
      </div>
      <Bars
        height={110}
        values={o.tickBudget}
        labels={o.prices.map((p) => fmtPrice(p))}
        format={(v) => usd(v)}
        tone={(i) => (r.clearing.atFloor || i > r.clearing.tick ? "var(--accent)" : i === r.clearing.tick && r.clearing.marginal > 0 ? "var(--gold)" : "var(--line)")}
        hint={(i) =>
          i > r.clearing.tick || r.clearing.atFloor
            ? tr(`出价 ${fmtPrice(o.prices[i])} · 全额成交`, `Bid ${fmtPrice(o.prices[i])} · fills fully`)
            : i === r.clearing.tick && r.clearing.marginal > 0
              ? tr(`出价 ${fmtPrice(o.prices[i])} · 按比例成交 ${pct(r.clearing.marginal / o.tickBudget[i], 0)}`, `Bid ${fmtPrice(o.prices[i])} · fills ${pct(r.clearing.marginal / o.tickBudget[i], 0)} pro rata`)
              : tr(`出价 ${fmtPrice(o.prices[i])} · 当前不成交，全额退回`, `Bid ${fmtPrice(o.prices[i])} · doesn't fill now, full refund`)
        }
      />
    </div>
  );
}

function Subscribe({ a, onDone }: { a: Asset; onDone?: () => void }) {
  const o = a.offering;
  const mine = S.me.escrow.find((e) => e.assetId === a.id && e.state === "active");
  const [amt, setAmt] = React.useState("100");
  const [tick, setTick] = React.useState(mine?.tick ?? o.prices.length - 1);
  const v = Number(amt) || 0;
  const r = roundView(a);
  const t = now();
  // What this bid would fill if the round closed now, with the bid included.
  const after = { ...o, tickBudget: o.tickBudget.map((b, i) => (i === tick ? b + v : b)), committed: o.committed + v };
  const fill = allocation(after, { budget: v + (mine?.budget ?? 0), tick });
  const myFill = mine ? allocation(o, mine) : { cost: 0, shares: 0 };
  const newCost = fill.cost - myFill.cost;
  const newShares = fill.shares - myFill.shares;
  const sharePct = (newShares / o.sharesForSale) * a.companyPct;
  const perPeriod = newShares * perShareDividend(a);
  const clearingAfter = roundView({ ...a, offering: after }).clearing.price;
  const status =
    v <= 0 ? "" : newCost >= v - 0.005 ? "full" : newCost > 0.005 ? "partial" : "none";

  return (
    <div className="stack">
      <div className="spread">
        <h3>{r.auction ? tr("首发认购 · 你来出价", "Launch round · name your price") : tr("首发认购", "Launch round")}</h3>
        <span className="muted num" style={{ fontSize: 13 }}>
          {r.auction ? `${fmtPrice(o.prices[0])} – ${fmtPrice(o.prices[o.prices.length - 1])}` : `${tr("统一价", "Fixed price")} ${fmtPrice(o.prices[0])}`}
        </span>
      </div>
      <div className="stack tight">
        <Meter value={Math.min(1, r.coverage)} />
        <div className="spread muted" style={{ fontSize: 12.5 }}>
          <span>
            <b className="num" style={{ color: "var(--ink)" }}>
              {tr(`认购 ${r.coverage.toFixed(2)} 倍`, `${r.coverage.toFixed(2)}x subscribed`)}
            </b>{" "}
            · {usdCompact(o.committed)} / {usdCompact(r.target)}
          </span>
          <span>{countdown(o.deadline, t)}</span>
        </div>
      </div>

      {r.auction && (
        <div className="stack tight">
          <span className="field" style={{ gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>{tr("你最高愿意出多少一份？", "The most you'd pay per share")}</span>
          </span>
          <div className="chips" role="radiogroup" aria-label={tr("出价", "Price")}>
            {o.prices.map((p, i) => (
              <button key={i} className="chip" aria-pressed={tick === i} disabled={!!mine && mine.tick !== i} onClick={() => setTick(i)}>
                {fmtPrice(p)}
              </button>
            ))}
          </div>
          <DemandLadder a={a} />
        </div>
      )}

      <label className="field" htmlFor={`sub-${a.id}`} style={{ gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>{tr("投入多少 USDT", "How much USDT")}</span>
      </label>
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
          [tr("按现在的认购簿，预计成交", "Fills now (estimate)"), `${usd(Math.max(0, newCost))} → ${fmtShares(Math.max(0, newShares))} ${tr("份", "sh")}`],
          [tr("预计清算价（所有人同价）", "Clearing price (same for all)"), fmtPrice(clearingAfter)],
          [a.instrument === "equity" ? tr("相当于公司股权", "Company equity") : tr("相当于收入权益", "Share of the stream"), `${Math.max(0, sharePct).toFixed(sharePct < 0.01 ? 4 : 3)}%`],
          [tr(`预计分红（${periodWord(a.commitment.periodDays)}）`, `Dividend (${periodWord(a.commitment.periodDays)})`), usd(Math.max(0, perPeriod)), "gold"],
          [tr("承诺年化（按清算价）", "Promised yield at clearing"), pct(yieldAt(a, clearingAfter)), "gold"],
        ]}
      />
      {status === "partial" && (
        <div className="callout warn">
          <IClock />
          <span style={{ fontSize: 13 }}>{tr("超额认购：这个价位按比例成交，没成交的部分截止后立即退回。出价更高能优先成交，但你仍然只付统一清算价。", "Oversubscribed: this price fills pro rata and the rest comes back right after close. Bid higher to fill first; you still only pay the clearing price.")}</span>
        </div>
      )}
      {status === "none" && (
        <div className="callout warn">
          <IClock />
          <span style={{ fontSize: 13 }}>{tr("按现在的认购簿，这个出价低于清算价，不会成交（截止后全额退回）。", "At the current book this bid is below the clearing price and won't fill (fully refunded after close).")}</span>
        </div>
      )}
      <div className="callout">
        <IShield />
        <span style={{ fontSize: 13 }}>
          {tr(
            "所有人按同一个清算价成交，出价高只是排在前面，不会多付；超额认购按比例分配，不拼手速。USDT 锁在托管合约里：成团 → 商户签约并完成工商变更 → 你确认收货，才放款给商户。",
            "Everyone pays one clearing price: bidding higher only puts you first, it never costs more. Oversubscription is pro rata, not first come. Your USDT waits in escrow until the round fills, the merchant registers the transfer and you confirm receipt.",
          )}
        </span>
      </div>
      <button
        className="btn primary lg block"
        disabled={!v || v > S.me.usdt}
        onClick={() => {
          if (run(() => subscribe(a.id, tick, v))) onDone?.();
        }}
      >
        {v > S.me.usdt ? tr("USDT 余额不足", "Not enough USDT") : r.auction ? tr(`以最高 ${fmtPrice(o.prices[tick])} 出价 ${usd(v)}`, `Bid ${usd(v)} up to ${fmtPrice(o.prices[tick])}`) : tr(`认购 ${usd(v)}`, `Subscribe ${usd(v)}`)}
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
      {p && claimable(p, a.dps) >= 0.01 && (
        <button className="btn ghost sm" onClick={() => run(() => reinvest(a.id))}>
          {tr(`分红复投：用 ${usd(claimable(p, a.dps))} 买入更多`, `Reinvest ${usd(claimable(p, a.dps))} into more shares`)}
        </button>
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
