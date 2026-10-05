import React from "react";
import type { EscrowOrder } from "../engine/types";
import { S, now, useWorld } from "../engine/store";
import { cancelOrder, cancelSubscription, claimArbitrationTimeout, confirmReceipt, dispute, disputeBondFor, refund, run, withdrawUnfilled } from "../engine/actions";
import { orderView } from "../engine/view";
import { EscrowTimeline } from "../components/EscrowTimeline";
import { Empty, StagePill, Tabs, Tile } from "../components/ui";
import { IReceipt, ILock } from "../components/icons";
import { tr } from "../lib/i18n";
import { dateTime, price as fmtPrice, shares as fmtShares, usd, TIME } from "../lib/format";
import { go } from "../lib/nav";

type F = "all" | "waiting" | "settling" | "confirm" | "done" | "refund";

function bucket(e: EscrowOrder): F {
  const a = S.assets.find((x) => x.id === e.assetId)!;
  if (e.state === "confirmed") return "done";
  if (e.state === "refunded" || e.state === "disputed" || a.stage === "failed") return "refund";
  if (a.offering.deliveredAt) return "confirm";
  if (a.stage === "ipo") return "waiting";
  return "settling";
}

export function Orders() {
  useWorld();
  const [f, setF] = React.useState<F>("all");
  const [reason, setReason] = React.useState<Record<string, string>>({});
  const count = (b: F) => S.me.escrow.filter((e) => bucket(e) === b).length;
  const list = S.me.escrow.filter((e) => f === "all" || bucket(e) === f);

  return (
    <>
      <div className="stack tight">
        <h1>{tr("我的订单", "My orders")}</h1>
        <p className="soft">{tr("每一笔认购都像担保交易：钱在合约里，商户交割、你确认收货之后才放款。", "Every subscription works like a buyer-protected purchase: the money waits in a contract until the merchant delivers and you confirm receipt.")}</p>
      </div>
      <Tabs<F>
        value={f}
        onChange={setF}
        items={[
          { id: "all", label: tr("全部", "All") },
          { id: "waiting", label: tr("待成团", "Filling"), count: count("waiting") },
          { id: "settling", label: tr("待交割", "Settling"), count: count("settling") },
          { id: "confirm", label: tr("待收货", "To confirm"), count: count("confirm"), alert: true },
          { id: "done", label: tr("已完成", "Done") },
          { id: "refund", label: tr("退款/仲裁", "Refunds"), count: count("refund") },
        ]}
      />
      {list.length === 0 && (
        <div className="card">
          <Empty icon={<IReceipt />} title={tr("这里还没有订单", "No orders here")}>
            <button className="btn primary sm" onClick={() => go("market")}>
              {tr("去看正在认购的生意", "See open rounds")}
            </button>
          </Empty>
        </div>
      )}
      <div className="grid-assets" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {list.map((e) => {
          const a = S.assets.find((x) => x.id === e.assetId)!;
          const b = bucket(e);
          const v = orderView(a, e);
          return (
            <div key={e.id} className="card stack">
              <div className="row" style={{ gap: 12 }}>
                <Tile a={a} />
                <button className="grow stack tight" style={{ gap: 2, border: 0, background: "none", padding: 0, textAlign: "left" }} onClick={() => go(`asset-${a.id}`)}>
                  <b>{a.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {tr("出价", "Bid")} {usd(e.budget, 2)} · {v.closed ? tr("成交", "filled") : tr("预计成交", "est. fill")} {usd(v.cost, 2)} → {fmtShares(v.shares)} {tr("份", "sh")}
                  </span>
                </button>
                <StagePill a={a} />
              </div>
              <EscrowTimeline a={a} e={e} />
              {v.unfilled > 0.004 && (
                <button className="btn ghost sm" onClick={() => run(() => withdrawUnfilled(e.id))}>
                  {tr(`取回未成交的 ${usd(v.unfilled, 2)}`, `Withdraw ${usd(v.unfilled, 2)} unfilled`)}
                </button>
              )}
              {b === "confirm" && e.state === "active" && v.shares > 0 && (
                <div className="stack tight">
                  <button className="btn primary block" onClick={() => run(() => confirmReceipt(e.id))}>
                    {tr("确认收货，放款给商户", "Confirm receipt and release payment")}
                  </button>
                  <div className="row">
                    <input
                      className="input"
                      id={`reason-${e.id}`}
                      style={{ height: 36 }}
                      placeholder={tr("仲裁理由（可选）", "Reason for dispute (optional)")}
                      value={reason[e.id] ?? ""}
                      onChange={(ev) => setReason({ ...reason, [e.id]: ev.target.value })}
                    />
                    <button className="btn sm ghost" onClick={() => run(() => dispute(e.id, reason[e.id] ?? ""))}>
                      {tr(`申请仲裁 · 押 ${usd(disputeBondFor(e.id), 2)}`, `Dispute · ${usd(disputeBondFor(e.id), 2)} bond`)}
                    </button>
                  </div>
                </div>
              )}
              {b === "waiting" && (
                <button className="btn ghost sm" onClick={() => run(() => cancelSubscription(e.id))}>
                  {tr("取消认购（全额退回）", "Cancel (full refund)")}
                </button>
              )}
              {a.stage === "failed" && e.state === "active" && (
                <button className="btn primary block" onClick={() => run(() => refund(e.id))}>
                  {tr(`退款 ${usd(v.held, 2)}`, `Refund ${usd(v.held, 2)}`)}
                </button>
              )}
              {e.state === "disputed" && (
                <div className="callout warn">
                  <ILock />
                  <div className="stack tight grow">
                    <span>
                      {tr(
                        `资金冻结，押金 ${usd(e.disputeBond ?? 0, 2)}：赢了全额退回，输了归商户。仲裁员 14 天内不处理，你可以自行全额退款（可在「审核台」演示仲裁）。`,
                        `Funds frozen with a ${usd(e.disputeBond ?? 0, 2)} bond: back to you if you're right, to the merchant if not. If no ruling within 14 days you can refund yourself (try it at the Verifier desk).`,
                      )}
                    </span>
                    {now() > (e.disputedAt ?? now()) + 14 * TIME.DAY && (
                      <button className="btn sm primary" onClick={() => run(() => claimArbitrationTimeout(e.id))}>
                        {tr("平台超时未裁决：自行全额退款", "No ruling in time: refund myself")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="two">
        <div className="card flush">
          <div className="li">
            <h3 className="grow">{tr("挂单", "Open orders")}</h3>
          </div>
          {S.me.orders.length === 0 ? (
            <Empty icon={<IReceipt />} title={tr("没有挂单", "No open orders")} />
          ) : (
            <div className="list">
              {S.me.orders.map((o) => {
                const a = S.assets.find((x) => x.id === o.assetId)!;
                return (
                  <div key={o.id} className="li">
                    <b className={o.side === "buy" ? "up" : "down"}>{o.side === "buy" ? tr("买", "Buy") : tr("卖", "Sell")}</b>
                    <span className="grow">
                      {a.symbol} · <span className="num">{fmtShares(o.size - o.filled)} @ {fmtPrice(o.price)}</span>
                    </span>
                    <button className="btn xs ghost" onClick={() => run(() => cancelOrder(o.id))}>
                      {tr("撤单", "Cancel")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card flush">
          <div className="li">
            <h3 className="grow">{tr("成交记录", "Trade history")}</h3>
          </div>
          {S.me.trades.length === 0 ? (
            <Empty icon={<IReceipt />} title={tr("还没有成交", "No trades yet")} />
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>{tr("时间", "Time")}</th>
                    <th>{tr("资产", "Asset")}</th>
                    <th>{tr("方向", "Side")}</th>
                    <th className="r">{tr("数量", "Size")}</th>
                    <th className="r">{tr("均价", "Price")}</th>
                    <th className="r">USDT</th>
                  </tr>
                </thead>
                <tbody>
                  {S.me.trades.slice(0, 30).map((tr_) => {
                    const a = S.assets.find((x) => x.id === tr_.assetId);
                    return (
                      <tr key={tr_.id}>
                        <td className="muted">{dateTime(tr_.at)}</td>
                        <td>{a?.symbol}</td>
                        <td className={tr_.side === "buy" ? "up" : "down"}>
                          {tr_.side === "buy" ? tr("买", "Buy") : tr("卖", "Sell")}
                          {tr_.maker ? tr("（挂单）", " (maker)") : ""}
                        </td>
                        <td className="r">{fmtShares(tr_.size)}</td>
                        <td className="r">{fmtPrice(tr_.price)}</td>
                        <td className="r">{usd(tr_.usdt, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
