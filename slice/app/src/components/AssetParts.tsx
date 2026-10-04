import React from "react";
import type { Asset, Question } from "../engine/types";
import { S, botBook, now } from "../engine/store";
import { ask, answer, bet, claimBet, markEvasive, run, upvote } from "../engine/actions";
import { dueDate, mergeBook, myPayout, potentialPayout, record, yesPrice } from "../engine/market";
import { liveMarket } from "../engine/ops";
import { Bars } from "./charts";
import { Flag, Meter, StatusDot, TrustRing, gradeTone } from "./ui";
import { IAlert, IChat, ICheck, IClock, IFile, ILock, IShield, ISpark, IThumb } from "./icons";
import { l, tr } from "../lib/i18n";
import { ago, countdown, date, price as fmtPrice, shares as fmtShares, shortHash, usd, usdCompact, TIME } from "../lib/format";

// ------------------------------------------------------------------ public Q&A

export function QA({ a, merchant = false }: { a: Asset; merchant?: boolean }) {
  const [text, setText] = React.useState("");
  const [sort, setSort] = React.useState<"hot" | "new" | "open">("hot");
  const t = now();
  const list = [...a.qa].sort((x, y) => (sort === "new" ? y.at - x.at : sort === "open" ? Number(!!x.answer) - Number(!!y.answer) || y.votes - x.votes : y.votes - x.votes));
  const open = a.qa.filter((q) => !q.answer).length;
  const late = a.qa.filter((q) => !q.answer && t - q.at > 72 * TIME.HOUR).length;
  const rate = a.qa.length ? (a.qa.length - open) / a.qa.length : 1;

  return (
    <div className="stack">
      <div className="kv sm">
        <div>
          <span className="k">{tr("问题", "Questions")}</span>
          <span className="v">{a.qa.length}</span>
        </div>
        <div>
          <span className="k">{tr("回答率", "Answered")}</span>
          <span className="v">{Math.round(rate * 100)}%</span>
        </div>
        <div>
          <span className="k">{tr("超时未答", "Overdue")}</span>
          <span className={`v ${late ? "down" : ""}`}>{late}</span>
        </div>
      </div>

      {!merchant && !a.mine && a.stage !== "failed" && (
        <div className="card stack" style={{ padding: 14 }}>
          <label className="field" htmlFor={`ask-${a.id}`}>
            <span>{tr("向老板公开提问，回答会归档进发行文件", "Ask the owner in public; answers are filed with the offering")}</span>
            <textarea
              id={`ask-${a.id}`}
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tr("例如：能上传最近 3 个月的 POS 日报吗？租约续期条款是什么？", "e.g. Can you upload the last 3 months of POS reports? What are the lease renewal terms?")}
            />
          </label>
          <div className="spread">
            <span className="muted" style={{ fontSize: 12.5 }}>
              {tr("商户须在 72 小时内回答；你可以标记“答非所问”。", "The merchant must answer within 72 hours; you can flag evasive answers.")}
            </span>
            <button
              className="btn primary sm"
              disabled={text.trim().length < 6}
              onClick={() => {
                if (run(() => ask(a.id, text)) !== undefined) setText("");
              }}
            >
              {tr("发布问题", "Post question")}
            </button>
          </div>
        </div>
      )}

      <div className="spread">
        <div className="seg">
          {(
            [
              ["hot", tr("最热", "Top")],
              ["new", tr("最新", "Newest")],
              ["open", tr(`待回答 ${open}`, `Unanswered ${open}`)],
            ] as const
          ).map(([id, label]) => (
            <button key={id} aria-pressed={sort === id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card flush list">
        {list.length === 0 && (
          <div className="empty">
            <IChat />
            <b>{tr("还没有问题", "No questions yet")}</b>
          </div>
        )}
        {list.map((q) => (
          <QItem key={q.id} a={a} q={q} merchant={merchant} />
        ))}
      </div>
    </div>
  );
}

function QItem({ a, q, merchant }: { a: Asset; q: Question; merchant: boolean }) {
  const [reply, setReply] = React.useState("");
  const [doc, setDoc] = React.useState("");
  const t = now();
  const deadline = q.at + 72 * TIME.HOUR;
  return (
    <div className="q">
      <div className="who">
        <span className={`avatar ${q.ai ? "ai" : ""}`}>{q.ai ? <ISpark /> : <Flag code={q.author.country} />}</span>
        <b>{q.ai ? tr("AI 尽调官", "AI due-diligence agent") : q.author.name}</b>
        <span>· {ago(q.at, t)}</span>
        {q.mine && <span className="pill accent">{tr("我的提问", "Mine")}</span>}
      </div>
      <div className="text">{l(q.text)}</div>
      {q.answer ? (
        <div className="ans">
          <span className="row" style={{ fontSize: 12.5, gap: 6 }}>
            <b style={{ color: "var(--ink)" }}>{a.owner.name}</b>
            <span className="muted">· {tr("商户回答", "Merchant")} · {ago(q.answer.at, t)}</span>
          </span>
          <span>{l(q.answer.text)}</span>
          {q.answer.doc && (
            <span className="pill">
              <IFile /> {tr("补充文件：", "Added: ")}
              {q.answer.doc}
            </span>
          )}
        </div>
      ) : merchant ? (
        <div className="stack tight">
          <textarea className="input" id={`reply-${q.id}`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tr("公开回答这个问题（会归档进发行文件）", "Answer in public (filed with the offering)")} />
          <div className="row wrap">
            <input className="input" id={`doc-${q.id}`} style={{ flex: 1, minWidth: 160, height: 36 }} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder={tr("补充文件名（可选）", "Supporting document (optional)")} />
            <button className="btn primary sm" disabled={reply.trim().length < 4} onClick={() => run(() => answer(a.id, q.id, reply, doc))}>
              {tr("发布回答", "Post answer")}
            </button>
          </div>
          <span className={t > deadline ? "down" : "muted"} style={{ fontSize: 12.5 }}>
            {t > deadline ? tr("已超过 72 小时，影响信任分", "Over 72 hours; this hurts the trust score") : tr(`剩余 ${countdown(deadline, t)}`, `${countdown(deadline, t)} left`)}
          </span>
        </div>
      ) : (
        <div className="ans pending">
          <span className={t > deadline ? "down" : ""} style={{ fontSize: 13.5 }}>
            {t > deadline ? tr("商户超时未回答", "The merchant is overdue") : tr(`等待商户回答 · 剩余 ${countdown(deadline, t)}`, `Waiting for the merchant · ${countdown(deadline, t)} left`)}
          </span>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn xs ghost" aria-pressed={!!q.voted} onClick={() => run(() => upvote(a.id, q.id))} style={q.voted ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
          <IThumb /> {q.votes}
        </button>
        {q.answer && !merchant && (
          <button className="btn xs quiet" onClick={() => run(() => markEvasive(a.id, q.id))} style={q.markedEvasive ? { color: "var(--down)" } : undefined}>
            {tr("答非所问", "Evasive")} {q.evasive > 0 ? q.evasive : ""}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI due-diligence report

export function AuditView({ a }: { a: Asset }) {
  const au = a.audit;
  if (!au) {
    return (
      <div className="card empty">
        <ISpark />
        <b>{tr("AI 尽调进行中", "AI review in progress")}</b>
        <span>{tr("完成后这里会显示信任分、逐项核验和风险点。", "The trust score, checks and risks will appear here.")}</span>
      </div>
    );
  }
  const parts: [string, number, number][] = [
    [tr("身份", "Identity"), au.breakdown.identity, 25],
    [tr("工商", "Registry"), au.breakdown.registry, 20],
    [tr("口碑", "Presence"), au.breakdown.presence, 20],
    [tr("财务", "Financials"), au.breakdown.financials, 25],
    [tr("法律", "Legal"), au.breakdown.legal, 10],
  ];
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
          <TrustRing audit={au} size={72} />
          <div className="stack tight grow">
            <div className="row wrap">
              <h3>
                {tr("信任分", "Trust score")} <span className="num">{au.trustScore}</span>
                <span className="muted num" style={{ fontSize: 13 }}>
                  /100
                </span>
              </h3>
              <span className={`pill ${au.verdict === "pass" ? "up" : au.verdict === "review" ? "warn" : "down"}`}>
                {au.verdict === "pass" ? tr("通过", "Pass") : au.verdict === "review" ? tr("需关注", "Review") : tr("未通过", "Reject")}
              </span>
            </div>
            <p className="soft" style={{ fontSize: 14 }}>
              {l(au.summary)}
            </p>
          </div>
        </div>
        <div className="breakdown">
          {parts.map(([k, v, max]) => (
            <div className="b" key={k}>
              <span className="muted">{k}</span>
              <div className="meter">
                <i style={{ width: `${(v / max) * 100}%`, background: gradeTone((v / max) * 100) }} />
              </div>
              <span className="num" style={{ textAlign: "right", fontWeight: 650 }}>
                {v}/{max}
              </span>
            </div>
          ))}
        </div>
        <div className="row wrap muted" style={{ fontSize: 12 }}>
          <ISpark size={14} />
          {au.source === "agent" ? tr("由 Claude 尽调 Agent 生成", "Generated by the Claude due-diligence agent") : tr("演示报告", "Demo report")} · {date(au.auditedAt)} ·{" "}
          <span className="mono">{shortHash(au.auditHash)}</span> {tr("已写入链上", "on-chain")}
        </div>
      </div>

      {au.metrics.length > 0 && (
        <div className="kv">
          {au.metrics.map((m) => (
            <div key={l(m.label)}>
              <span className="k">{l(m.label)}</span>
              <span className="v" style={{ fontSize: 15 }}>
                {typeof m.value === "string" ? m.value : l(m.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {au.flags.length > 0 && (
        <div className="card flush list">
          <div className="li">
            <h3>{tr("风险点", "Risk flags")}</h3>
          </div>
          {au.flags.map((f, i) => (
            <div className="flag" key={i}>
              <span className={`pill ${f.severity === "high" ? "down" : f.severity === "medium" ? "warn" : ""}`}>
                {f.severity === "high" ? tr("高", "High") : f.severity === "medium" ? tr("中", "Med") : tr("低", "Low")}
              </span>
              <div className="stack tight" style={{ gap: 2 }}>
                <b style={{ fontSize: 14 }}>{l(f.title)}</b>
                <span className="soft" style={{ fontSize: 13.5 }}>
                  {l(f.detail)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card flush list">
        <div className="li">
          <h3>{tr("逐项核验", "Checks")}</h3>
        </div>
        {au.checks.map((c, i) => (
          <div className="audit-check" key={i}>
            <StatusDot s={c.status} />
            <div className="stack tight" style={{ gap: 3, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{l(c.title)}</b>
              <span className="soft" style={{ fontSize: 13.5 }}>
                {l(c.finding)}
              </span>
              {c.evidence.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {c.evidence.map((e, j) =>
                    e.url ? (
                      <a key={j} className="pill" href={e.url} target="_blank" rel="noreferrer">
                        {e.label}
                      </a>
                    ) : (
                      <span key={j} className="pill">
                        {e.label}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {au.monitoring.length > 0 && (
        <div className="card stack">
          <h3>{tr("上链后 AI 哨兵持续监控", "Monitored by the AI sentinel after listing")}</h3>
          <div className="stack tight">
            {au.monitoring.map((m, i) => (
              <div className="row soft" key={i} style={{ fontSize: 14 }}>
                <IShield size={16} /> {l(m)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dividend commitment

export function CommitmentView({ a }: { a: Asset }) {
  const c = a.commitment;
  const t = now();
  const rec = record(c);
  const showN = Math.min(c.numPeriods, 16);
  const labels = Array.from({ length: showN }, (_, i) => `${i + 1}`);
  const values = Array.from({ length: showN }, (_, i) => (c.status[i] === "pending" ? c.perPeriod : c.paid[i]));
  const tone = (i: number) =>
    c.status[i] === "paid" ? "var(--gold)" : c.status[i] === "late" ? "var(--warn)" : c.status[i] === "defaulted" ? "var(--down)" : "var(--line)";
  const next = c.status.indexOf("pending");
  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread">
          <h3>{tr("分红承诺", "Dividend promise")}</h3>
          <span className="pill">
            <ILock /> {tr("保证金", "Bond")} {usd(c.bond)}
          </span>
        </div>
        <p className="soft" style={{ fontSize: 14 }}>
          {l(a.terms)}
        </p>
        <div className="kv">
          <div>
            <span className="k">{tr("每期金额", "Per period")}</span>
            <span className="v gold">{usd(c.perPeriod)}</span>
            <span className="s">{tr(`每 ${c.periodDays} 天`, `every ${c.periodDays} days`)}</span>
          </div>
          <div>
            <span className="k">{tr("履约记录", "Record")}</span>
            <span className="v">
              {rec.paid}/{rec.settled}
            </span>
            <span className="s">
              {rec.late ? tr(`${rec.late} 次延迟 · `, `${rec.late} late · `) : ""}
              {rec.defaulted ? tr(`${rec.defaulted} 次违约`, `${rec.defaulted} defaults`) : tr("无违约", "no defaults")}
            </span>
          </div>
          <div>
            <span className="k">{tr("下一期", "Next")}</span>
            <span className="v">{next === -1 ? "—" : date(dueDate(c, next), false)}</span>
            <span className="s">{next === -1 ? "" : t < dueDate(c, next) ? countdown(dueDate(c, next), t) : tr("宽限期中", "in grace period")}</span>
          </div>
          <div>
            <span className="k">{tr("已累计分配", "Paid out so far")}</span>
            <span className="v">{usdCompact(a.distributed)}</span>
          </div>
        </div>
        <Bars
          values={values}
          labels={labels}
          tone={tone}
          format={(v) => usd(v)}
          hint={(i) =>
            `${tr("第", "Period ")}${i + 1}${tr("期", "")} · ${date(dueDate(c, i))} · ${
              c.status[i] === "paid" ? tr("按时", "on time") : c.status[i] === "late" ? tr("延迟", "late") : c.status[i] === "defaulted" ? tr("违约·保证金赔付", "default · bond paid") : tr("待付", "pending")
            }`
          }
        />
        <div className="row wrap muted" style={{ fontSize: 12.5, gap: 12 }}>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--gold)", display: "inline-block" }} /> {tr("按时", "On time")}
          </span>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--warn)", display: "inline-block" }} /> {tr("延迟", "Late")}
          </span>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--down)", display: "inline-block" }} /> {tr("违约（保证金赔付）", "Default (bond paid)")}
          </span>
          <span className="row" style={{ gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--line)", display: "inline-block" }} /> {tr("未到期", "Upcoming")}
          </span>
        </div>
      </div>
      <div className="callout gold">
        <ILock />
        <span>
          {tr(
            `规则写在合约里：到期后有 ${c.graceDays} 天宽限期；仍未付款，任何人都可以触发罚没，保证金直接按持股比例分给持有人，违约记录永久上链。商户想提高承诺，必须先追加保证金。`,
            `The rules live in the contract: ${c.graceDays} days of grace after each due date; if still unpaid, anyone can trigger the slash, the bond goes straight to holders pro rata, and the default stays on-chain. To promise more, the merchant must post more bond first.`,
          )}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ confidence market

export function ConfidenceCard({ a }: { a: Asset }) {
  const [side, setSide] = React.useState<"yes" | "no" | null>(null);
  const [amt, setAmt] = React.useState("20");
  const settled = a.markets.filter((m) => m.resolved && m.myYes + m.myNo > 0 && !m.claimed);
  const m = liveMarket(a);
  const t = now();
  return (
    <div className="card stack">
      <div className="spread">
        <span className="eyebrow">{tr("信心市场", "Confidence market")}</span>
        <span className="pill">
          {tr("奖池", "Pool")} {usdCompact((m?.yes ?? 0) + (m?.no ?? 0))}
        </span>
      </div>
      {settled.map((s) => (
        <div key={s.period} className="callout good">
          <ICheck />
          <div className="stack tight grow">
            <span>
              {tr(`第 ${s.period + 1} 期已结算：${s.resolved === "yes" ? "按时兑现" : "未兑现"}`, `Period ${s.period + 1} settled: ${s.resolved === "yes" ? "paid on time" : "not honored"}`)}
            </span>
            <button className="btn sm primary" onClick={() => run(() => claimBet(a.id, s.period))}>
              {tr(`领取 ${usd(myPayout(s))}`, `Claim ${usd(myPayout(s))}`)}
            </button>
          </div>
        </div>
      ))}
      {m ? (
        <>
          <h3 style={{ lineHeight: 1.35 }}>
            {tr(
              `${a.name} 第 ${m.period + 1} 期 ${usd(a.commitment.perPeriod)} 分红，能在 ${date(dueDate(a.commitment, m.period))} 前按时到账吗？`,
              `Will ${a.name} pay period ${m.period + 1}'s ${usd(a.commitment.perPeriod)} by ${date(dueDate(a.commitment, m.period))}?`,
            )}
          </h3>
          <div className="spread">
            <span className="prob up">{Math.round(yesPrice(m) * 100)}%</span>
            <span className="muted" style={{ fontSize: 12.5, textAlign: "right" }}>
              {tr("市场认为会按时兑现", "chance it's paid on time")}
              <br />
              {t < dueDate(a.commitment, m.period) ? tr(`${countdown(dueDate(a.commitment, m.period), t)}后停止交易`, `closes in ${countdown(dueDate(a.commitment, m.period), t)}`) : tr("等待结算", "awaiting result")}
            </span>
          </div>
          <div className="conf">
            <div className="bar">
              <i style={{ width: `${yesPrice(m) * 100}%` }} />
            </div>
          </div>
          {!a.mine && (
            <div className="yesno">
              <button className="y" aria-pressed={side === "yes"} onClick={() => setSide(side === "yes" ? null : "yes")}>
                {tr("会", "Yes")} <small>{Math.round(yesPrice(m) * 100)}¢</small>
              </button>
              <button className="n" aria-pressed={side === "no"} onClick={() => setSide(side === "no" ? null : "no")}>
                {tr("不会", "No")} <small>{Math.round((1 - yesPrice(m)) * 100)}¢</small>
              </button>
            </div>
          )}
          {side && (
            <div className="stack tight">
              <div className="row">
                <input className="input num" id={`bet-${a.id}`} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="USDT" />
                <button
                  className={`btn ${side === "yes" ? "up" : "down"}`}
                  onClick={() => {
                    if (run(() => bet(a.id, m.period, side, Number(amt))) !== undefined) setSide(null);
                  }}
                >
                  {tr("下注", "Bet")} ${Number(amt) || 0}
                </button>
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {tr(`若猜对，按当前奖池可得约 ${usd(potentialPayout(m, side, Number(amt) || 0))}`, `If right, you'd get about ${usd(potentialPayout(m, side, Number(amt) || 0))} at current pools`)}
              </span>
            </div>
          )}
          {(m.myYes > 0 || m.myNo > 0) && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              {tr("我的仓位：", "My position: ")}
              {m.myYes > 0 && <b className="up">{tr("会", "Yes")} {usd(m.myYes)} </b>}
              {m.myNo > 0 && <b className="down">{tr("不会", "No")} {usd(m.myNo)}</b>}
            </span>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            {a.mine
              ? tr("你是这门生意的商户，结果由你决定，所以不能交易它。", "You run this business and decide the outcome, so you can't trade it.")
              : tr("结果直接读取链上分红记录结算，没有预言机。持有人可以买“不会”对冲违约风险。", "Settles straight from the on-chain payout record, no oracle. Holders can buy No to hedge default risk.")}
          </p>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {tr("开放认购后，每一期分红都会有一个信心市场。", "Each payout gets a confidence market once the round opens.")}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ order book

export function OrderBookView({ a }: { a: Asset }) {
  const mine = S.me.orders.filter((o) => o.assetId === a.id).map((o) => ({ id: o.id, side: o.side, price: o.price, remaining: o.size - o.filled }));
  const b = mergeBook(botBook(a), mine);
  const asks = b.asks.slice(0, 7).reverse();
  const bids = b.bids.slice(0, 7);
  const max = Math.max(...asks.map((x) => x.size), ...bids.map((x) => x.size), 1);
  const spread = b.asks[0] && b.bids[0] ? b.asks[0].price - b.bids[0].price : 0;
  return (
    <div className="card flush">
      <div className="book">
        <div className="lv muted" style={{ fontSize: 12, fontWeight: 650 }}>
          <span>{tr("价格", "Price")}</span>
          <span style={{ textAlign: "right" }}>{tr("数量", "Size")}</span>
          <span>{tr("金额", "Total")}</span>
        </div>
        {asks.map((x, i) => (
          <div key={`a${i}`} className={`lv ask ${x.mine ? "mine" : ""}`}>
            <i style={{ width: `${(x.size / max) * 100}%` }} />
            <span className="down">{fmtPrice(x.price)}</span>
            <span>{fmtShares(x.size)}</span>
            <span>{usd(x.size * x.price)}</span>
          </div>
        ))}
        <div className="mid">
          <span className="num">{fmtPrice(a.price)}</span>
          <span className="muted num" style={{ fontWeight: 500, fontSize: 12.5 }}>
            {tr("价差", "Spread")} {fmtPrice(spread)}
          </span>
        </div>
        {bids.map((x, i) => (
          <div key={`b${i}`} className={`lv bid ${x.mine ? "mine" : ""}`}>
            <i style={{ width: `${(x.size / max) * 100}%` }} />
            <span className="up">{fmtPrice(x.price)}</span>
            <span>{fmtShares(x.size)}</span>
            <span>{usd(x.size * x.price)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ documents

const KIND: Record<string, [string, string]> = {
  registry: ["工商", "Registry"],
  id: ["身份", "ID"],
  bank: ["银行流水", "Bank"],
  tax: ["税务", "Tax"],
  lease: ["租约", "Lease"],
  license: ["许可", "Licence"],
  pos: ["数据直连", "Live feed"],
  agreement: ["协议", "Agreement"],
  royalty: ["版税", "Royalties"],
  other: ["补充", "Other"],
};

export function DocsList({ a }: { a: Asset }) {
  return (
    <div className="card flush list">
      {a.docs.map((d) => (
        <div className="li" key={d.id}>
          <span className="status-dot pass">
            <IFile />
          </span>
          <div className="grow stack tight" style={{ gap: 1 }}>
            <b style={{ fontSize: 14 }}>{l(d.name)}</b>
            <span className="row wrap muted" style={{ fontSize: 12, gap: 6 }}>
              <span className="pill">{tr(...(KIND[d.kind] ?? KIND.other))}</span>
              {d.byRequest && <span className="pill accent">{tr("应提问补充", "Added on request")}</span>}
              <span className="mono">{shortHash(d.hash)}</span>
            </span>
          </div>
          {d.verified ? (
            <span className="pill up">
              <ICheck /> {tr("已核验", "Verified")}
            </span>
          ) : (
            <span className="pill warn">
              <IClock /> {tr("待核验", "Pending")}
            </span>
          )}
        </div>
      ))}
      {a.docs.length === 0 && (
        <div className="empty">
          <IFile />
          <b>{tr("暂无文件", "No documents")}</b>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ overview

const MONTHS_ZH = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Overview({ a }: { a: Asset }) {
  const m = new Date(now()).getMonth();
  const labels = Array.from({ length: 12 }, (_, i) => {
    const k = (m - 11 + i + 12) % 12;
    return tr(MONTHS_ZH[k], MONTHS_EN[k]);
  });
  const flags = a.audit?.flags.filter((f) => f.severity === "high") ?? [];
  return (
    <div className="stack">
      {flags.map((f, i) => (
        <div className="callout bad" key={i}>
          <IAlert />
          <span>
            <b>{l(f.title)}</b> · {l(f.detail)}
          </span>
        </div>
      ))}
      <div className="card stack">
        <h3>{tr("关于这门生意", "About the business")}</h3>
        <p className="soft">{l(a.about)}</p>
        <div className="row wrap" style={{ gap: 8, fontSize: 13.5 }}>
          <span className="pill">
            {tr("负责人", "Owner")} · {a.owner.name}
          </span>
          <span className="pill">
            {tr("经营自", "Since")} {a.owner.since}
          </span>
          <span className="pill">
            <Flag code={a.country} label />
          </span>
        </div>
      </div>
      <div className="card stack">
        <div className="spread">
          <h3>{tr("近 12 个月营收", "Revenue, last 12 months")}</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {tr("来源：POS / 平台只读直连 + 银行流水", "Source: read-only POS / platform feed + bank statements")}
          </span>
        </div>
        <Bars values={a.monthly} labels={labels} format={(v) => usd(v)} tone={() => "var(--accent)"} />
      </div>
      {a.stage === "ipo" && (
        <div className="card stack">
          <h3>{tr("认购进度", "Round progress")}</h3>
          <Meter value={a.offering.raised / (a.offering.sharesForSale * a.offering.price)} />
          <div className="kv">
            <div>
              <span className="k">{tr("已认购", "Raised")}</span>
              <span className="v">{usdCompact(a.offering.raised)}</span>
            </div>
            <div>
              <span className="k">{tr("目标", "Target")}</span>
              <span className="v">{usdCompact(a.offering.sharesForSale * a.offering.price)}</span>
            </div>
            <div>
              <span className="k">{tr("最低成团", "Minimum")}</span>
              <span className="v">{usdCompact(a.offering.minRaise)}</span>
            </div>
            <div>
              <span className="k">{tr("认购人数", "Investors")}</span>
              <span className="v">{a.offering.investors.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
      <div className="callout">
        <IAlert />
        <span style={{ fontSize: 13 }}>
          {tr(
            "演示数据：本页的生意、人物与数字均为虚构，用于展示产品流程；交易使用测试网模拟 USDT。",
            "Demo data: the businesses, people and numbers here are fictional and show how the product works; trades use simulated testnet USDT.",
          )}
        </span>
      </div>
    </div>
  );
}
