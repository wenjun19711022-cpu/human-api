import React from "react";
import type { Asset, Category } from "../engine/types";
import { S, now, useWorld } from "../engine/store";
import { AssetCard, Tape } from "../components/AssetCard";
import { CATEGORY, Flag, Meter, Tile, TrustRing } from "../components/ui";
import { IClock, IGift, IStore, IShield, ILock, ISpark } from "../components/icons";
import { l, tr } from "../lib/i18n";
import { countdown, usdCompact, pct } from "../lib/format";
import { go } from "../lib/nav";
import { faucet, run } from "../engine/actions";
import { yieldAt } from "../engine/market";

type Sort = "hot" | "launch" | "yield" | "trust" | "new";

function score(a: Asset, sort: Sort): number {
  switch (sort) {
    case "hot":
      return a.volume24h + (a.stage === "ipo" ? a.offering.raised * 0.08 : 0) + a.qa.length * 120 + (a.stage === "review" ? -1e9 : 0);
    case "launch":
      return a.stage === "ipo" ? 3e12 - a.offering.deadline : a.stage === "qa" ? 2e12 - (a.qaEndsAt ?? 0) : a.stage === "settling" ? 1e12 : -a.price;
    case "yield":
      return a.stage === "review" ? -1 : yieldAt(a, a.stage === "trading" ? a.price : a.offering.price);
    case "trust":
      return a.audit?.trustScore ?? -1;
    case "new":
      return a.listedAt ?? a.offering.opensAt;
  }
}

export function Market() {
  useWorld();
  const [cat, setCat] = React.useState<Category | "all">("all");
  const [sort, setSort] = React.useState<Sort>("hot");
  const t = now();
  const cats = [...new Set(S.assets.map((a) => a.category))];
  const list = S.assets.filter((a) => cat === "all" || a.category === cat).sort((x, y) => score(y, sort) - score(x, sort));
  const live = S.assets.filter((a) => a.stage === "ipo").sort((x, y) => x.offering.deadline - y.offering.deadline);
  const featured = live.find((a) => !a.mine) ?? live[0];
  const paid = S.assets.reduce((s, a) => s + a.distributed, 0);
  const escrow = S.assets.reduce((s, a) => s + (a.stage === "ipo" || (a.stage === "settling" && !a.offering.deliveredAt) ? a.offering.raised : 0), 0);
  const countries = new Set(S.assets.map((a) => a.country)).size;

  return (
    <>
      <section className="hero">
        <div className="l">
          <span className="eyebrow">{tr("全球生意交易所 · 测试网演示", "The world's business exchange · testnet demo")}</span>
          <h1>{tr("用 USDT，买下世界上任何一门生意的一片", "Own a slice of any business on earth, with USDT")}</h1>
          <p className="soft" style={{ maxWidth: 560 }}>
            {tr(
              "洛杉矶的酒吧、首尔的一首歌、肯尼亚的太阳能电站。资金先进托管合约，商户完成工商登记、你确认收货才放款；承诺的分红有保证金兜底。",
              "A bar in LA, a song from Seoul, a solar grid in Kenya. Your money waits in escrow until the merchant registers the transfer and you confirm receipt, and every promised dividend is backed by a bond.",
            )}
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            {S.me.usdt < 200 ? (
              <button className="btn primary" onClick={() => run(faucet)}>
                <IGift /> {tr("领取 1,000 测试 USDT", "Get 1,000 test USDT")}
              </button>
            ) : (
              <button className="btn primary" onClick={() => featured && go(`asset-${featured.id}`)}>
                {tr("开始买第一片", "Buy your first slice")}
              </button>
            )}
            <button className="btn ghost" onClick={() => go("merchant")}>
              <IStore /> {tr("我要把生意上链", "Take my business on-chain")}
            </button>
          </div>
          <div className="kv">
            <div>
              <span className="k">{tr("在线生意", "Businesses")}</span>
              <span className="v">{S.assets.length}</span>
            </div>
            <div>
              <span className="k">{tr("覆盖国家", "Countries")}</span>
              <span className="v">{countries}</span>
            </div>
            <div>
              <span className="k">{tr("累计分红", "Dividends paid")}</span>
              <span className="v gold">{usdCompact(paid)}</span>
            </div>
            <div>
              <span className="k">{tr("托管中资金", "Held in escrow")}</span>
              <span className="v">{usdCompact(escrow)}</span>
            </div>
          </div>
        </div>
        {featured && (
          <div className="r">
            <span className="eyebrow">{tr("正在认购", "Round closing soonest")}</span>
            <div className="row" style={{ gap: 12 }}>
              <Tile a={featured} size="lg" />
              <div className="grow stack tight" style={{ gap: 2 }}>
                <h2 style={{ fontSize: 19 }}>{featured.name}</h2>
                <span className="row muted" style={{ fontSize: 13 }}>
                  <Flag code={featured.country} /> {l(featured.city)}
                </span>
              </div>
              <TrustRing audit={featured.audit} size={44} />
            </div>
            <Meter value={featured.offering.raised / (featured.offering.sharesForSale * featured.offering.price)} />
            <div className="spread" style={{ fontSize: 13 }}>
              <span>
                <b className="num">{usdCompact(featured.offering.raised)}</b> <span className="muted">/ {usdCompact(featured.offering.sharesForSale * featured.offering.price)}</span>
              </span>
              <span className="row muted" style={{ gap: 4 }}>
                <IClock size={14} /> {countdown(featured.offering.deadline, t)}
              </span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="pill gold">{tr(`承诺年化 ${pct(yieldAt(featured, featured.offering.price))}`, `${pct(yieldAt(featured, featured.offering.price))} promised yield`)}</span>
              <span className="pill">
                <ILock /> {tr("资金托管", "Escrowed")}
              </span>
              <span className="pill">
                <IShield /> {tr("保证金兜底", "Bond-backed")}
              </span>
            </div>
            <button className="btn primary block" onClick={() => go(`asset-${featured.id}`)}>
              {tr("查看并认购", "View & subscribe")}
            </button>
          </div>
        )}
      </section>

      <Tape />

      <div className="stack">
        <div className="chips" role="toolbar" aria-label={tr("分类", "Categories")}>
          <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
            {tr("全部", "All")}
          </button>
          {cats.map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {tr(...CATEGORY[c])}
            </button>
          ))}
        </div>
        <div className="spread wrap">
          <div className="seg" style={{ overflowX: "auto", maxWidth: "100%" }}>
            {(
              [
                ["hot", tr("最热", "Hot")],
                ["launch", tr("首发", "Launches")],
                ["yield", tr("高分红", "Yield")],
                ["trust", tr("高信任", "Trust")],
                ["new", tr("新上链", "New")],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={sort === id} onClick={() => setSort(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className="row muted hide-sm" style={{ fontSize: 12.5 }}>
            <ISpark size={14} /> {tr("每一门生意都经过 AI 尽调 + 公开问答", "Every listing passes AI due diligence and public Q&A")}
          </span>
        </div>
        <div className="grid-assets">
          {list.map((a) => (
            <AssetCard key={a.id} a={a} />
          ))}
        </div>
      </div>
    </>
  );
}
