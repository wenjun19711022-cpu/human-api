import React from "react";
import { S, useWorld } from "../engine/store";
import { HUNTER, MIN_ORACLE_CALLS, hunterBoard, landlordBoard, oracleBoard, type Row } from "../engine/board";
import { mePerson } from "../engine/ops";
import { flag } from "../engine/geo";
import { Seg } from "../components/ui";
import { IChat, ICoin, IPulse, ITrophy } from "../components/icons";
import { tr } from "../lib/i18n";
import { usd } from "../lib/format";
import { go } from "../lib/nav";

type B = "oracle" | "hunter" | "landlord";
const SHOW = 15;

function scoreText(b: B, r: Row) {
  if (b === "hunter") return tr(`${Math.round(r.score)} 分`, `${Math.round(r.score)} pts`);
  if (b === "oracle") return `${r.score > 0.005 ? "+" : r.score < -0.005 ? "−" : ""}${usd(Math.abs(r.score), 2)}`;
  return usd(r.score, 2);
}

function detailText(b: B, r: Row) {
  if (b === "oracle") {
    if (r.detail.b < MIN_ORACLE_CALLS) return tr(`已结算 ${r.detail.b} 次 · 满 ${MIN_ORACLE_CALLS} 次上榜`, `${r.detail.b} settled · ${MIN_ORACLE_CALLS} to qualify`);
    return tr(`猜中 ${r.detail.a}/${r.detail.b} · ${Math.round((r.detail.a / r.detail.b) * 100)}%`, `Right ${r.detail.a}/${r.detail.b} · ${Math.round((r.detail.a / r.detail.b) * 100)}%`);
  }
  if (b === "hunter") {
    const parts = [];
    if (r.detail.a) parts.push(tr(`逼出 ${r.detail.a} 份文件`, `${r.detail.a} documents forced`));
    if (r.detail.b) parts.push(tr(`揭穿 ${r.detail.b} 次答非所问`, `${r.detail.b} dodges exposed`));
    return parts.join(" · ") || tr("点赞来自其他投资人", "Upvotes from other investors");
  }
  return tr(`持有 ${r.detail.a} 门生意`, `Holds ${r.detail.a} businesses`);
}

function tone(b: B, r: Row) {
  if (b !== "oracle" || Math.abs(r.score) < 0.005) return "";
  return r.score > 0 ? "up" : "down";
}

function qualifies(b: B, r: Row) {
  return b !== "oracle" || r.detail.b >= MIN_ORACLE_CALLS;
}

export function Leaderboards() {
  useWorld();
  const [b, setB] = React.useState<B>("oracle");
  const me = mePerson();
  const rows = b === "oracle" ? oracleBoard(S.rivals, S.assets, me) : b === "hunter" ? hunterBoard(S.assets, me) : landlordBoard(S.rivals, S.assets, S.me, me);
  const ranked = rows.filter((r) => qualifies(b, r));
  const myRow = rows.find((r) => r.me);
  const myRank = myRow && qualifies(b, myRow) ? ranked.indexOf(myRow) + 1 : 0;
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3, SHOW);

  const rule: Record<B, [React.ReactNode, string, string, string, string, string]> = {
    oracle: [
      <IPulse />,
      "按信心市场已结算的净盈亏排名，至少结算 3 次才上榜。猜对“会不会按时分红”，就是在帮所有人给风险定价。",
      "Ranked by settled confidence-market P&L, with at least 3 settled calls. Calling payouts right prices risk for everyone.",
      "去信心市场下注",
      "Make a call",
      "confidence",
    ],
    hunter: [
      <IChat />,
      `只算别人给你的点赞，自己的不算；问题逼出一份文件 +${HUNTER.DOC}，回答被 ${HUNTER.DODGE_FLAGS} 人以上标为“答非所问” +${HUNTER.DODGE}。只提问不加分，刷问题没用。`,
      `Only other people's upvotes count. A question that forces a document earns +${HUNTER.DOC}; one whose answer ${HUNTER.DODGE_FLAGS}+ people flag as evasive earns +${HUNTER.DODGE}. Asking alone earns nothing.`,
      "去问一个好问题",
      "Ask a sharp question",
      "market",
    ],
    landlord: [
      <ICoin />,
      "按真正收到的分红排名（已领取 + 待领取），不按持仓市值，也不按花了多少钱。买得贵不会让你上榜，选得准才会。",
      "Ranked by dividends actually received (claimed + claimable), not by holdings or money spent. Paying more doesn't rank you; picking well does.",
      "去收租",
      "Collect dividends",
      "portfolio",
    ],
  };
  const [icon, zh, en, ctaZh, ctaEn, to] = rule[b];

  return (
    <>
      <div className="stack tight">
        <span className="eyebrow">{tr("本季榜单", "This season")}</span>
        <h1>{tr("排行榜", "Leaderboards")}</h1>
        <p className="soft" style={{ maxWidth: 680 }}>
          {tr("这里只奖励让市场更诚实的行为：猜得准、问到点子上、真的收到分红。成交量和下单次数都不算分。", "Only behavior that makes the market more honest ranks here: calling payouts right, asking what matters, actually collecting dividends. Volume and order count earn nothing.")}
        </p>
      </div>

      <Seg<B>
        value={b}
        onChange={setB}
        items={[
          { id: "oracle", label: tr("先知榜", "Oracles") },
          { id: "hunter", label: tr("尽调猎人榜", "Hunters") },
          { id: "landlord", label: tr("收租榜", "Landlords") },
        ]}
      />

      <div className="callout">
        {icon}
        <div className="stack tight grow">
          <span>{tr(zh, en)}</span>
          <button className="btn xs ghost" style={{ justifySelf: "start" }} onClick={() => go(to)}>
            {tr(ctaZh, ctaEn)}
          </button>
        </div>
      </div>

      <div className="podium">
        {top.map((r, i) => (
          <div key={r.who.name + i} className={`p p${i + 1} ${r.me ? "me" : ""}`}>
            <span className="medal">{i + 1}</span>
            <span className="avatar lg">{flag(r.who.country)}</span>
            <b className="nm">{r.who.name}</b>
            <span className={`num sc ${tone(b, r)}`}>{scoreText(b, r)}</span>
            <span className="muted dt">{detailText(b, r)}</span>
          </div>
        ))}
      </div>

      <div className="card flush">
        <div className="list">
          {rest.map((r, i) => (
            <RowLine key={r.who.name + i} b={b} r={r} rank={i + 4} />
          ))}
          {myRow && (myRank === 0 || myRank > SHOW) && (
            <>
              <div className="li muted" style={{ justifyContent: "center", fontSize: 12.5 }}>
                ···
              </div>
              <RowLine b={b} r={myRow} rank={myRank} />
            </>
          )}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5 }}>
        <ITrophy size={14} /> {tr("榜单数据都来自链上可查的记录：ConfidenceMarket 的结算、问答与文件哈希、ShareToken 的分红记账。", "Every number here comes from records anyone can check on-chain: ConfidenceMarket settlements, Q&A and document hashes, ShareToken dividend accounting.")}
      </p>
    </>
  );
}

function RowLine({ b, r, rank }: { b: B; r: Row; rank: number }) {
  return (
    <div className={`li rank ${r.me ? "me" : ""}`}>
      <span className="pos num">{rank > 0 ? rank : "—"}</span>
      <span className="avatar">{flag(r.who.country)}</span>
      <div className="grow stack tight" style={{ gap: 0, minWidth: 0 }}>
        <b>{r.who.name}</b>
        <span className="muted" style={{ fontSize: 12 }}>
          {detailText(b, r)}
        </span>
      </div>
      <b className={`num ${tone(b, r)}`}>{scoreText(b, r)}</b>
    </div>
  );
}
