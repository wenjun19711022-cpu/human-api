import React from "react";
import type { Asset, ConfMarket } from "../engine/types";
import { S, now, useWorld } from "../engine/store";
import { dueDate, myPayout, yesPrice } from "../engine/market";
import { ConfidenceCard } from "../components/AssetParts";
import { Empty, Flag, Sheet, Tile } from "../components/ui";
import { IPulse } from "../components/icons";
import { l, tr } from "../lib/i18n";
import { countdown, date, usd, usdCompact } from "../lib/format";
import { go } from "../lib/nav";

export function Confidence() {
  useWorld();
  const [open, setOpen] = React.useState<Asset | null>(null);
  const t = now();
  const live: { a: Asset; m: ConfMarket }[] = [];
  const mineSettled: { a: Asset; m: ConfMarket }[] = [];
  for (const a of S.assets) {
    for (const m of a.markets) {
      if (!m.resolved && t < dueDate(a.commitment, m.period)) live.push({ a, m });
      else if (m.resolved && m.myYes + m.myNo > 0) mineSettled.push({ a, m });
    }
  }
  live.sort((x, y) => y.m.yes + y.m.no - (x.m.yes + x.m.no));

  return (
    <>
      <div className="stack tight">
        <h1>{tr("信心市场", "Confidence markets")}</h1>
        <p className="soft" style={{ maxWidth: 680 }}>
          {tr(
            "每一期承诺分红都有一个“会 / 不会按时兑现”的市场。价格就是全世界投资人给出的违约概率；持有人可以买“不会”对冲风险。结算直接读取链上分红记录，没有人能操纵结果。",
            "Every promised payout has a Yes/No market on whether it arrives on time. The price is the crowd's default probability, and holders can buy No as a hedge. Settlement reads the on-chain payout record directly, so nobody can fix the result.",
          )}
        </p>
      </div>

      {live.length === 0 ? (
        <div className="card">
          <Empty icon={<IPulse />} title={tr("暂时没有开放的市场", "No open markets right now")} />
        </div>
      ) : (
        <div className="grid-assets">
          {live.map(({ a, m }) => {
            const p = yesPrice(m);
            return (
              <div key={a.id + m.period} className="acard" style={{ cursor: "default" }}>
                <div className="row" style={{ gap: 12 }}>
                  <Tile a={a} />
                  <button className="grow stack tight" style={{ gap: 2, border: 0, background: "none", padding: 0, textAlign: "left" }} onClick={() => go(`asset-${a.id}`)}>
                    <b className="name">{a.name}</b>
                    <span className="row muted" style={{ fontSize: 12.5 }}>
                      <Flag code={a.country} /> {l(a.city)}
                    </span>
                  </button>
                  <span className="prob" style={{ fontSize: 26, color: p >= 0.6 ? "var(--up)" : p >= 0.4 ? "var(--warn)" : "var(--down)" }}>
                    {Math.round(p * 100)}%
                  </span>
                </div>
                <b style={{ fontSize: 14.5, lineHeight: 1.4 }}>
                  {tr(
                    `第 ${m.period + 1} 期 ${usd(a.commitment.perPeriod)} 会在 ${date(dueDate(a.commitment, m.period), false)} 前按时到账吗？`,
                    `Will period ${m.period + 1}'s ${usd(a.commitment.perPeriod)} arrive by ${date(dueDate(a.commitment, m.period), false)}?`,
                  )}
                </b>
                <div className="conf">
                  <div className="bar">
                    <i style={{ width: `${p * 100}%` }} />
                  </div>
                </div>
                <div className="spread muted" style={{ fontSize: 12.5 }}>
                  <span>
                    {tr("奖池", "Pool")} {usdCompact(m.yes + m.no)}
                  </span>
                  <span>{countdown(dueDate(a.commitment, m.period), t)}</span>
                </div>
                <div className="yesno">
                  <button className="y" onClick={() => setOpen(a)} disabled={a.mine}>
                    {tr("会", "Yes")} <small>{Math.round(p * 100)}¢</small>
                  </button>
                  <button className="n" onClick={() => setOpen(a)} disabled={a.mine}>
                    {tr("不会", "No")} <small>{Math.round((1 - p) * 100)}¢</small>
                  </button>
                </div>
                {(m.myYes > 0 || m.myNo > 0) && (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {tr("我的仓位：", "Mine: ")}
                    {m.myYes > 0 && <b className="up">{tr("会", "Yes")} {usd(m.myYes)} </b>}
                    {m.myNo > 0 && <b className="down">{tr("不会", "No")} {usd(m.myNo)}</b>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mineSettled.length > 0 && (
        <div className="card flush">
          <div className="li">
            <h3>{tr("我参与过的已结算市场", "My settled markets")}</h3>
          </div>
          <div className="list">
            {mineSettled.map(({ a, m }) => (
              <div className="li" key={a.id + m.period}>
                <Tile a={a} />
                <span className="grow">
                  {a.name} · {tr(`第 ${m.period + 1} 期`, `period ${m.period + 1}`)} ·{" "}
                  <b className={m.resolved === "yes" ? "up" : "down"}>{m.resolved === "yes" ? tr("按时兑现", "Paid") : tr("未兑现", "Missed")}</b>
                </span>
                <b className="num">{m.claimed ? tr("已领取", "Claimed") : usd(myPayout(m), 2)}</b>
                {!m.claimed && (
                  <button className="btn xs primary" onClick={() => setOpen(a)}>
                    {tr("领取", "Claim")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} label={open?.name ?? ""}>
        {open && <ConfidenceCard a={open} />}
      </Sheet>
    </>
  );
}
