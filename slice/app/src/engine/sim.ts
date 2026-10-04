/**
 * The rest of the world: other investors from 24 countries trade, subscribe and bet; bot-run merchants
 * sign, deliver and pay (or default). Every transition goes through the same ops the user's actions use.
 */
import type { Asset, L } from "./types";
import { S, botBook, commit, getAsset, nextId, now, refreshBook } from "./store";
import {
  badge,
  closeRound,
  confirmOrder,
  deliver,
  failRound,
  feed,
  gainXp,
  myEscrowPaid,
  notice,
  openRound,
  payMerchant,
  pushPrice,
  recordPayment,
  resolveMarkets,
  slashPeriod,
  botWillPay,
} from "./ops";
import { PEOPLE } from "./geo";
import { dueDate, moveShares, sweep, yieldAt } from "./market";
import { between, fakeHash, pick, rng } from "../lib/rand";
import { TIME } from "../lib/format";

const DAY = TIME.DAY;
const HOUR = TIME.HOUR;
const L_ = (zh: string, en: string): L => ({ zh, en });

// ------------------------------------------------------------------ lifecycle

export function processLifecycle(t = now()) {
  for (const a of S.assets) {
    const o = a.offering;
    const c = a.commitment;

    if (a.stage === "qa" && !a.mine && a.qaEndsAt && t >= a.qaEndsAt) openRound(a, t);

    if (a.stage === "ipo" && (o.sold >= o.sharesForSale - 1e-6 || t >= o.deadline)) closeRound(a, t);

    if (a.stage === "settling") {
      const since = o.deadline;
      if (!a.mine) {
        if (!o.agreementHash && t >= since + 2 * DAY) {
          o.agreementHash = fakeHash(a.id + "agreement");
          o.agreementAt = t;
        }
        if (o.agreementHash && !o.registrationProof && t >= since + 4 * DAY) {
          o.registrationProof = fakeHash(a.id + "registry");
          o.proofUploadedAt = t;
        }
      }
      if (o.registrationProof && o.proofUploadedAt && !o.deliveredAt && t >= o.proofUploadedAt + DAY) deliver(a, t);
      else if (!o.deliveredAt && o.settleDeadline && t > o.settleDeadline) {
        failRound(a, L_("商户未按期交割", "merchant did not deliver in time"));
      }
    }

    if (o.deliveredAt) {
      // Auto-confirm (EscrowOffering.autoConfirm) after the confirm window.
      const autoAt = o.deliveredAt + o.confirmDays * DAY;
      if (t >= autoAt) {
        for (const e of S.me.escrow) {
          if (e.assetId === a.id && e.state === "active") {
            confirmOrder(e.id, true);
            notice(L_(`${a.name} 已自动确认收货，${e.shares.toFixed(2)} 份已到你的钱包。`, `${a.name} auto-confirmed: ${e.shares.toFixed(2)} shares are in your wallet.`), "good", a.id);
          }
        }
        if (a.mine) {
          const pending = o.raised - myEscrowPaid(a.id) - o.merchantReceived / (1 - o.feeBps / 10_000);
          if (pending > 1) {
            payMerchant(a, pending);
            notice(L_(`剩余投资款 $${Math.round(pending * 0.97).toLocaleString()} 已自动确认并到账。`, `The remaining $${Math.round(pending * 0.97).toLocaleString()} auto-confirmed and arrived.`), "good", a.id);
          }
        }
      }

      // Dividend periods.
      for (let i = 0; i < c.numPeriods; i++) {
        if (c.status[i] !== "pending") continue;
        const due = dueDate(c, i);
        if (t < due) break;
        if (!a.mine && botWillPay(a, i)) recordPayment(a, i, due);
        else if (t > due + c.graceDays * DAY) slashPeriod(a, i, t);
        else break;
      }
      resolveMarkets(a, t);
    } else if (a.stage === "failed") {
      resolveMarkets(a, t);
    }
  }
}

// ------------------------------------------------------------------ daily step (used by fast-forward)

function fairPrice(a: Asset): number {
  // Investors price a promised payout at a target yield that depends on the track record.
  const defaults = a.commitment.status.filter((s) => s === "defaulted").length;
  const target = 0.1 + defaults * 0.08 + (100 - (a.audit?.trustScore ?? 70)) / 600;
  return a.price * Math.pow(yieldAt(a) / target, 0.08);
}

export function dailyStep(t: number) {
  for (const a of S.assets) {
    if (a.stage === "trading") {
      const drift = Math.log(fairPrice(a) / a.price);
      const p = a.price * Math.exp(drift + (rng() - 0.5) * 0.035);
      pushPrice(a, p, t);
      a.history.push({ t, p: a.price });
      a.intraday = a.intraday.slice(-6);
      a.volume24h = Math.round(a.price * a.totalShares * between(0.003, 0.015));
      refreshBook(a);
    }
    if (a.stage === "ipo") {
      const o = a.offering;
      const want = o.sharesForSale * o.price * a.demand * between(0.025, 0.075);
      const shares = Math.min(want / o.price, o.sharesForSale - o.sold);
      o.sold += shares;
      o.raised += shares * o.price;
      o.investors += Math.round(shares / 450);
    }
    if ((a.stage === "qa" || a.stage === "ipo") && a.mine && rng() < 0.55) botQuestion(a, t);
    for (const m of a.markets) {
      if (m.resolved) continue;
      const belief = Math.min(0.97, Math.max(0.05, a.commitment.reliability + (rng() - 0.5) * 0.15));
      const amt = between(40, 400);
      if (rng() < belief) m.yes += amt;
      else m.no += amt;
    }
  }
}

export function advance(days: number) {
  const startNotices = S.notices.length;
  for (let d = 0; d < days; d++) {
    S.offset += DAY;
    const t = now();
    dailyStep(t);
    processLifecycle(t);
  }
  S.lastDay = Math.floor(now() / DAY);
  commit();
  return S.notices.length - startNotices;
}

/** Process days that passed in real time since the last visit. */
export function catchUp() {
  const today = Math.floor(now() / DAY);
  const missed = Math.min(60, today - S.lastDay);
  for (let d = missed - 1; d >= 0; d--) dailyStep(now() - d * DAY);
  S.lastDay = today;
  processLifecycle();
  commit();
}

// ------------------------------------------------------------------ live bots

const QUESTIONS: { q: L; a: L }[] = [
  {
    q: L_("如果营业额下降 30%，你还能按承诺分红吗？", "If revenue fell 30%, could you still pay the promised dividend?"),
    a: L_("能。承诺分红只占过去 12 个月平均利润的约 70%，另外还有保证金兜底。", "Yes. The promise is about 70% of average profit over 12 months, and the bond backs it."),
  },
  {
    q: L_("老板每年给自己发多少工资？运营协议里有上限吗？", "What salary do you pay yourself, and is it capped in the operating agreement?"),
    a: L_("年薪 $6.8 万，运营协议规定涨薪需持有人多数同意。", "$68K a year. Raises need a majority holder vote under the operating agreement."),
  },
  {
    q: L_("融资的钱具体怎么花？能给一份预算表吗？", "How exactly will the money be spent? Can you share a budget?"),
    a: L_("预算表已上传：装修 55%、设备 30%、营运资金 15%。", "Budget uploaded: 55% fit-out, 30% equipment, 15% working capital."),
  },
  {
    q: L_("公司现在有没有其他贷款或股东？", "Does the company have other loans or shareholders today?"),
    a: L_("有一笔 $4 万的设备贷款，2027 年还清；没有其他股东。", "One $40K equipment loan, repaid in 2027. No other shareholders."),
  },
  {
    q: L_("如果你以后想卖掉整个公司，持有人怎么处理？", "If you sell the whole company later, what happens to holders?"),
    a: L_("协议里有随售权：任何整体出售，持有人按同样价格同比例退出。", "There's a tag-along: in any sale, holders exit pro rata at the same price."),
  },
  {
    q: L_("能上传最近一个月的 POS 日报截图吗？", "Can you upload last month's daily POS reports?"),
    a: L_("已上传，POS 也已经只读直连，平台每天自动同步。", "Uploaded. The POS is also connected read-only and syncs daily."),
  },
];

function botQuestion(a: Asset, t: number) {
  const used = new Set(a.qa.map((q) => q.text.en));
  const fresh = QUESTIONS.filter((x) => !used.has(x.q.en));
  if (!fresh.length) return;
  const pickQ = pick(fresh);
  a.qa.unshift({ id: nextId("q"), author: pick(PEOPLE), text: pickQ.q, at: t, votes: Math.floor(between(1, 30)), evasive: 0 });
  feed("ask", a.qa[0].author, a.id);
  if (a.mine) notice(L_(`${a.name} 收到新提问，请在 72 小时内回答。`, `New question on ${a.name}. Answer within 72 hours.`), "info", a.id);
}

function botAnswer(a: Asset, t: number) {
  if (a.mine) return; // only the user answers for their own business
  const q = a.qa.find((x) => !x.answer && !x.mine && t - x.at > 6 * HOUR);
  if (!q) return;
  const tpl = QUESTIONS.find((x) => x.q.en === q.text.en);
  q.answer = { text: tpl?.a ?? L_("已补充说明并上传相关文件。", "Added an explanation and uploaded the documents."), at: t };
  feed("answer", { name: a.owner.name, country: a.country }, a.id);
}

/** A bot takes liquidity from the book; my resting orders fill if they are in the way. */
function botTrade(a: Asset) {
  const b = botBook(a);
  const mine = S.me.orders.filter((o) => o.assetId === a.id);
  const buy = rng() < 0.52 + Math.max(-0.1, Math.min(0.1, Math.log(fairPrice(a) / a.price) * 3));
  const who = pick(PEOPLE);
  const usd = Math.exp(between(Math.log(40), Math.log(3_500)));

  // Combine bot levels and my orders into one side of the book, best first.
  const side = buy ? "asks" : "bids";
  const levels = [
    ...b[side].map((l) => ({ ...l })),
    ...mine.filter((o) => (buy ? o.side === "sell" : o.side === "buy")).map((o) => ({ price: o.price, size: o.size - o.filled, mine: o.id })),
  ].sort((x, y) => (buy ? x.price - y.price : y.price - x.price));

  const res = buy ? sweep(levels, { budget: usd, side: "buy" }) : sweep(levels, { maxShares: usd / a.price, side: "sell" });
  if (!res.size) return;
  for (const f of res.fills) {
    if (f.mine) fillMyOrder(a, f.mine, f.price, f.size);
    else {
      const lv = b[side].find((l) => l.price === f.price);
      if (lv) lv.size -= f.size;
    }
  }
  b[side] = b[side].filter((l) => l.size > 1e-6);
  const last = res.fills[res.fills.length - 1].price;
  pushPrice(a, last);
  a.volume24h += res.cost;
  feed(buy ? "buy" : "sell", who, a.id, Math.round(res.cost));
  if (b.asks.length < 4 || b.bids.length < 4) refreshBook(a);
}

/** My resting limit order was hit (I'm the maker, so no fee). Mirrors ShareExchange._fillAsk/_fillBid. */
function fillMyOrder(a: Asset, orderId: string, price: number, size: number) {
  const o = S.me.orders.find((x) => x.id === orderId);
  if (!o) return;
  const p = S.me.positions[a.id];
  const usdt = price * size;
  if (o.side === "sell" && p) {
    p.locked -= size;
    const frac = size / p.shares;
    p.cost -= p.cost * frac;
    moveShares(p, -size, a.dps);
    S.me.usdt += usdt;
  } else if (o.side === "buy") {
    o.escrow -= usdt;
    const pos = (S.me.positions[a.id] ??= { shares: 0, locked: 0, cost: 0, corr: 0, withdrawn: 0 });
    moveShares(pos, size, a.dps);
    pos.cost += usdt;
  }
  o.filled += size;
  S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: o.side, price, size, usdt, fee: 0, at: now(), maker: true });
  if (o.size - o.filled < 1e-6) {
    if (o.side === "buy" && o.escrow > 0) S.me.usdt += o.escrow;
    S.me.orders = S.me.orders.filter((x) => x.id !== orderId);
    notice(L_(`你的${o.side === "buy" ? "买单" : "卖单"} ${a.symbol} @ $${price.toFixed(2)} 已全部成交。`, `Your ${o.side} order ${a.symbol} @ $${price.toFixed(2)} filled.`), "good", a.id);
  }
  gainXp(10);
  if (o.side === "buy") badge("first");
}

export function botTick() {
  const t = now();
  const r = rng();
  const trading = S.assets.filter((a) => a.stage === "trading");
  const ipos = S.assets.filter((a) => a.stage === "ipo");

  if (r < 0.55 && trading.length) {
    botTrade(pick(trading));
  } else if (r < 0.8 && ipos.length) {
    const a = pick(ipos);
    const o = a.offering;
    const amt = Math.min(Math.exp(between(Math.log(50), Math.log(4_000))) * a.demand, (o.sharesForSale - o.sold) * o.price);
    if (amt > 1) {
      o.sold += amt / o.price;
      o.raised += amt;
      if (rng() < 0.6) o.investors += 1;
      feed("subscribe", pick(PEOPLE), a.id, Math.round(amt));
    }
  } else if (r < 0.9) {
    const withMarkets = S.assets.filter((a) => a.markets.some((m) => !m.resolved && t < dueDate(a.commitment, m.period)));
    if (withMarkets.length) {
      const a = pick(withMarkets);
      const m = a.markets.find((x) => !x.resolved)!;
      const yes = rng() < a.commitment.reliability;
      const amt = Math.round(between(10, 300));
      if (yes) m.yes += amt;
      else m.no += amt;
      feed("bet", pick(PEOPLE), a.id, amt);
    }
  } else {
    const open = S.assets.filter((a) => a.stage === "qa" || a.stage === "ipo");
    if (open.length) {
      const a = pick(open);
      if (rng() < 0.5) botAnswer(a, t);
      else if (a.qa.length < 9) botQuestion(a, t);
    }
  }
  processLifecycle(t);
  commit();
}

export function assetOrThrow(id: string): Asset {
  const a = getAsset(id);
  if (!a) throw new Error("unknown asset " + id);
  return a;
}
