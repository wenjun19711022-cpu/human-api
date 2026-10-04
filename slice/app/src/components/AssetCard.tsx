import React from "react";
import type { Asset, FeedItem } from "../engine/types";
import { Flag, Meter, StagePill, Tile, TrustRing, INSTRUMENT } from "./ui";
import { Sparkline } from "./charts";
import { l, tr } from "../lib/i18n";
import { countdown, price as fmtPrice, usdCompact, pct } from "../lib/format";
import { change, yieldAt, yesPrice } from "../engine/market";
import { now } from "../engine/store";
import { go } from "../lib/nav";
import { liveMarket } from "../engine/ops";
import { IChat, IClock, ISpark } from "./icons";
import { S } from "../engine/store";

export function AssetCard({ a }: { a: Asset }) {
  const t = now();
  const ch = change(a.history.concat(a.intraday), t, 86_400_000, a.price);
  const m = liveMarket(a);
  const y = yieldAt(a, a.stage === "trading" ? a.price : a.offering.price);
  const open = a.qa.filter((q) => !q.answer).length;
  return (
    <button className="acard" onClick={() => go(`asset-${a.id}`)} aria-label={a.name}>
      <div className="row" style={{ gap: 12 }}>
        <Tile a={a} />
        <div className="grow">
          <div className="name">{a.name}</div>
          <div className="row muted" style={{ fontSize: 12.5, gap: 6 }}>
            <Flag code={a.country} /> {l(a.city)} · {tr(...INSTRUMENT[a.instrument])}
          </div>
        </div>
        <TrustRing audit={a.audit} size={38} />
      </div>
      <div className="tag">{l(a.tagline)}</div>

      {a.stage === "trading" && (
        <div className="foot">
          <div className="stack tight">
            <span className="big-price">{fmtPrice(a.price)}</span>
            <span className={`num ${ch >= 0 ? "up" : "down"}`} style={{ fontSize: 13, fontWeight: 700 }}>
              {ch >= 0 ? "+" : ""}
              {pct(ch, 2)} <span className="muted" style={{ fontWeight: 500 }}>24h</span>
            </span>
          </div>
          <Sparkline points={a.history.slice(-30).map((p) => p.p).concat(a.price)} up={ch >= 0} />
        </div>
      )}

      {a.stage === "ipo" && (
        <div className="stack tight">
          <div className="spread" style={{ fontSize: 13 }}>
            <span>
              <b className="num">{pct(a.offering.raised / (a.offering.sharesForSale * a.offering.price), 0)}</b> <span className="muted">{tr("已认购", "subscribed")}</span>
            </span>
            <span className="row muted" style={{ gap: 4 }}>
              <IClock size={14} /> {countdown(a.offering.deadline, t)}
            </span>
          </div>
          <Meter value={a.offering.raised / (a.offering.sharesForSale * a.offering.price)} />
          <div className="muted" style={{ fontSize: 12.5 }}>
            {usdCompact(a.offering.raised)} / {usdCompact(a.offering.sharesForSale * a.offering.price)} · {a.offering.investors.toLocaleString()} {tr("人", "investors")}
          </div>
        </div>
      )}

      {a.stage === "qa" && (
        <div className="callout warn" style={{ padding: "10px 12px" }}>
          <IChat />
          <span>
            {tr(`公开问答中 · ${a.qa.length} 个问题，${open} 个待回答`, `Public Q&A · ${a.qa.length} questions, ${open} unanswered`)}
            {a.qaEndsAt ? tr(` · ${countdown(a.qaEndsAt, t)}后开放认购`, ` · round opens in ${countdown(a.qaEndsAt, t)}`) : ""}
          </span>
        </div>
      )}

      {a.stage === "settling" && (
        <div className="callout" style={{ padding: "10px 12px" }}>
          <IClock />
          <span>
            {a.offering.deliveredAt
              ? tr("工商登记已核验 · 投资人确认收货中", "Registry verified · investors confirming receipt")
              : tr("已成团 · 等待商户签约与登记变更", "Round filled · waiting for the merchant to sign and register")}
          </span>
        </div>
      )}

      {a.stage === "review" && (
        <div className="callout" style={{ padding: "10px 12px" }}>
          <ISpark />
          <span>{tr("AI 正在核验工商、身份、口碑和银行流水", "AI is checking registry, identity, reputation and bank records")}</span>
        </div>
      )}

      {a.stage === "failed" && (
        <div className="callout bad" style={{ padding: "10px 12px" }}>
          <IClock />
          <span>{tr("认购失败，托管资金全额可退", "Round failed; escrowed funds are fully refundable")}</span>
        </div>
      )}

      <div className="row wrap" style={{ gap: 6 }}>
        <StagePill a={a} />
        {a.stage !== "review" && <span className="pill gold">{tr(`承诺年化 ${pct(y, 1)}`, `${pct(y, 1)} promised yield`)}</span>}
        {m && (
          <span className="pill" title={tr("信心市场：下一期能否按时分红", "Confidence market: will the next payout arrive on time")}>
            {tr("信心", "Confidence")} <b className={yesPrice(m) >= 0.6 ? "up" : yesPrice(m) >= 0.4 ? "" : "down"}>{Math.round(yesPrice(m) * 100)}%</b>
          </span>
        )}
      </div>
    </button>
  );
}

export function feedVerb(f: FeedItem): string {
  switch (f.kind) {
    case "buy":
      return tr("买入", "bought");
    case "sell":
      return tr("卖出", "sold");
    case "subscribe":
      return tr("认购", "subscribed to");
    case "dividend":
      return tr("派发分红", "paid a dividend on");
    case "default":
      return tr("违约，保证金赔付", "defaulted; bond paid out on");
    case "ask":
      return tr("提问", "asked about");
    case "answer":
      return tr("回答了问题", "answered on");
    case "bet":
      return tr("押注信心", "bet on");
    case "listed":
      return tr("开放上链", "listed");
    case "delivered":
      return tr("完成交割", "delivered");
  }
}

export function Tape() {
  const items = S.feed.slice(0, 18);
  if (items.length < 3) return null;
  const doubled = [...items, ...items];
  return (
    <div className="tape" aria-label={tr("全球实时成交", "Live activity worldwide")}>
      <div className="track">
        {doubled.map((f, i) => {
          const a = S.assets.find((x) => x.id === f.assetId);
          return (
            <span className="item" key={f.id + i}>
              <Flag code={f.who.country} />
              <b>{f.who.name}</b>
              {feedVerb(f)}
              <b>{a?.symbol}</b>
              {f.amount ? <span className="num">${f.amount.toLocaleString()}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
