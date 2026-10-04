/**
 * Everything the user can do. Each action validates like the matching contract function and throws an
 * ActionError with a message that tells the user what to do instead.
 */
import type { Asset, Audit, Category, Doc, DocKind, Draft, L } from "./types";
import { S, botBook, commit, getAsset, nextId, now, refreshBook, toastL, ui } from "./store";
import {
  badge,
  checkGlobal,
  confirmOrder,
  deliver,
  ensureMarket,
  feed,
  gainXp,
  mePerson,
  notice,
  pushPrice,
  recordPayment,
} from "./ops";
import { TAKER_FEE, claimable, dueDate, emptyPosition, moveShares, myPayout, round2, sweep } from "./market";
import { TIME } from "../lib/format";
import { tr } from "../lib/i18n";
import { fakeHash } from "../lib/rand";
import { defaultDraft } from "./seed";
import { advance, processLifecycle } from "./sim";

const DAY = TIME.DAY;
const L_ = (zh: string, en: string): L => ({ zh, en });

export class ActionError extends Error {}
function need(ok: unknown, zh: string, en: string): asserts ok {
  if (!ok) throw new ActionError(tr(zh, en));
}
function asset(id: string): Asset {
  const a = getAsset(id);
  need(a, "找不到这个资产", "Asset not found");
  return a;
}

/** Run an action; turn ActionErrors into a toast. Returns the action's result or undefined. */
export function run<T>(fn: () => T): T | undefined {
  try {
    const out = fn();
    commit();
    return out;
  } catch (err) {
    if (err instanceof ActionError) ui.emit({ type: "toast", text: err.message, tone: "bad" });
    else {
      console.error(err);
      ui.emit({ type: "toast", text: String(err), tone: "bad" });
    }
    commit();
    return undefined;
  }
}

// ------------------------------------------------------------------ wallet

export function faucet() {
  need(now() - S.me.faucetAt > DAY / 24, "每小时可领取一次测试 USDT", "Test USDT can be claimed once an hour");
  S.me.faucetAt = now();
  S.me.usdt += 1_000;
  ui.emit({ type: "coins", amount: 1_000 });
  toastL(L_("已领取 1,000 测试 USDT", "Received 1,000 test USDT"), "good");
}

/** One-time testnet grant so a merchant can post a realistic bond in the demo. */
export function merchantGrant() {
  need(S.me.merchantAssetId, "先提交上链申请", "Submit an application first");
  need(!S.me.granted, "商户测试资金只能领取一次", "The merchant grant can only be claimed once");
  S.me.granted = true;
  S.me.usdt += 10_000;
  ui.emit({ type: "coins", amount: 10_000 });
}

// ------------------------------------------------------------------ launch rounds (EscrowOffering)

export function subscribe(assetId: string, amount: number) {
  const a = asset(assetId);
  const o = a.offering;
  need(a.stage === "ipo", "这个资产当前不在认购期", "This asset isn't taking subscriptions right now");
  need(now() < o.deadline, "认购已截止", "The round has closed");
  need(amount >= 1, "最低认购 $1", "Minimum is $1");
  need(amount <= S.me.usdt + 1e-9, "USDT 余额不足，先去「我的」领取测试 USDT", "Not enough USDT. Get test USDT under Me.");
  need(!a.mine, "商户不能认购自己的资产", "Merchants can't subscribe to their own round");
  const remaining = o.sharesForSale - o.sold;
  need(remaining > 1e-9, "额度已售罄", "Sold out");
  let shares = amount / o.price;
  let cost = amount;
  if (shares > remaining) {
    shares = remaining;
    cost = remaining * o.price;
  }
  S.me.usdt -= cost;
  o.sold += shares;
  o.raised += cost;
  let e = S.me.escrow.find((x) => x.assetId === a.id && x.state === "active");
  if (!e) {
    e = { id: nextId("e"), assetId: a.id, paid: 0, shares: 0, state: "active", at: now() };
    S.me.escrow.unshift(e);
    o.investors += 1;
  }
  e.paid = round2(e.paid + cost);
  e.shares += shares;
  feed("subscribe", mePerson(), a.id, Math.round(cost));
  gainXp(25);
  badge("early");
  badge("first");
  ui.emit({ type: "confetti" });
  return { shares, cost };
}

export function cancelSubscription(orderId: string) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  need(e && e.state === "active", "订单不可取消", "This order can't be cancelled");
  const a = asset(e.assetId);
  need(a.stage === "ipo", "认购已截止，不能再取消；若认购失败会自动可退款", "The round has closed; if it fails you can refund");
  a.offering.sold -= e.shares;
  a.offering.raised -= e.paid;
  a.offering.investors = Math.max(0, a.offering.investors - 1);
  S.me.usdt += e.paid;
  S.me.escrow = S.me.escrow.filter((x) => x.id !== orderId);
  toastL(L_(`已取消，$${e.paid.toFixed(2)} 原路退回`, `Cancelled; $${e.paid.toFixed(2)} returned`), "info");
}

export function confirmReceipt(orderId: string) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  need(e && e.state === "active", "这个订单不需要确认", "Nothing to confirm on this order");
  const a = asset(e.assetId);
  need(a.offering.deliveredAt, "商户尚未完成交割，资金继续托管", "The merchant hasn't delivered yet; your money stays in escrow");
  confirmOrder(orderId, false);
  gainXp(30);
  badge("receipt");
  ui.emit({ type: "confetti" });
  toastL(L_(`已确认收货：${e.shares.toFixed(2)} 份 ${a.symbol} 到账，$${e.paid.toFixed(2)} 已放款给商户`, `Confirmed: ${e.shares.toFixed(2)} ${a.symbol} shares received; $${e.paid.toFixed(2)} released to the merchant`), "good");
}

export function dispute(orderId: string, reason: string) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  need(e && e.state === "active", "这个订单不能申请仲裁", "This order can't be disputed");
  const a = asset(e.assetId);
  need(a.offering.deliveredAt, "交割前资金本来就在托管中", "Before delivery your money is already in escrow");
  need(now() < a.offering.deliveredAt + a.offering.confirmDays * DAY, "确认期已过", "The confirmation window has passed");
  e.state = "disputed";
  e.disputeReason = reason || tr("工商登记记录与协议不符", "Registry record doesn't match the agreement");
  notice(L_(`已提交仲裁：${a.name}。资金冻结，等待平台仲裁员处理。`, `Dispute filed for ${a.name}. Funds are frozen until an arbitrator decides.`), "warn", a.id);
}

export function refund(orderId: string) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  need(e && e.state === "active", "这个订单不能退款", "This order can't be refunded");
  const a = asset(e.assetId);
  need(a.stage === "failed", "只有认购失败的订单可以退款", "Only failed rounds can be refunded");
  e.state = "refunded";
  e.closedAt = now();
  S.me.usdt += e.paid;
  toastL(L_(`$${e.paid.toFixed(2)} 已全额退回`, `$${e.paid.toFixed(2)} refunded in full`), "good");
}

// ------------------------------------------------------------------ trading (ShareExchange)

function applyBookFills(a: Asset, side: "asks" | "bids", fills: { price: number; size: number }[]) {
  const b = botBook(a);
  for (const f of fills) {
    const lv = b[side].find((l) => Math.abs(l.price - f.price) < 1e-9);
    if (lv) lv.size -= f.size;
  }
  b[side] = b[side].filter((l) => l.size > 1e-6);
  if (b[side].length < 3) refreshBook(a);
}

export function marketBuy(assetId: string, usdt: number) {
  const a = asset(assetId);
  need(a.stage === "trading", "这个资产还没开放交易", "This asset isn't trading yet");
  need(usdt >= 1, "最低 $1", "Minimum is $1");
  need(usdt <= S.me.usdt + 1e-9, "USDT 余额不足", "Not enough USDT");
  const res = sweep(botBook(a).asks, { budget: usdt, side: "buy" });
  need(res.size > 0, "暂时没有卖单", "No sellers right now");
  applyBookFills(a, "asks", res.fills);
  const total = res.cost + res.fee;
  S.me.usdt -= total;
  const p = (S.me.positions[a.id] ??= emptyPosition());
  moveShares(p, res.size, a.dps);
  p.cost += total;
  const last = res.fills[res.fills.length - 1].price;
  pushPrice(a, last);
  a.volume24h += res.cost;
  S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: "buy", price: res.avgPrice, size: res.size, usdt: total, fee: res.fee, at: now() });
  feed("buy", mePerson(), a.id, Math.round(res.cost));
  gainXp(20);
  badge("first");
  checkGlobal();
  ui.emit({ type: "confetti" });
  return res;
}

export function marketSell(assetId: string, qty: number) {
  const a = asset(assetId);
  const p = S.me.positions[a.id];
  need(a.stage === "trading", "这个资产还没开放交易", "This asset isn't trading yet");
  need(p && p.shares - p.locked >= qty - 1e-9 && qty > 0, "可卖份额不足", "Not enough free shares");
  const res = sweep(botBook(a).bids, { maxShares: qty, side: "sell" });
  need(res.size > 0, "暂时没有买单", "No buyers right now");
  applyBookFills(a, "bids", res.fills);
  const net = res.cost - res.fee;
  S.me.usdt += net;
  p.cost -= p.cost * (res.size / p.shares);
  moveShares(p, -res.size, a.dps);
  pushPrice(a, res.fills[res.fills.length - 1].price);
  a.volume24h += res.cost;
  S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: "sell", price: res.avgPrice, size: res.size, usdt: net, fee: res.fee, at: now() });
  feed("sell", mePerson(), a.id, Math.round(res.cost));
  gainXp(10);
  return res;
}

export function placeLimit(assetId: string, side: "buy" | "sell", price: number, size: number) {
  const a = asset(assetId);
  need(a.stage === "trading", "这个资产还没开放交易", "This asset isn't trading yet");
  need(price > 0 && size > 0, "请输入价格和数量", "Enter a price and a size");
  const b = botBook(a);
  if (side === "buy") {
    const maxCost = price * size * (1 + TAKER_FEE);
    need(maxCost <= S.me.usdt + 1e-9, "USDT 余额不足", "Not enough USDT");
    // Marketable part fills immediately at the resting price (maker price), like ShareExchange.placeLimit.
    const res = sweep(b.asks, { maxShares: size, limit: price, side: "buy" });
    if (res.size > 0) {
      applyBookFills(a, "asks", res.fills);
      const p = (S.me.positions[a.id] ??= emptyPosition());
      moveShares(p, res.size, a.dps);
      p.cost += res.cost + res.fee;
      S.me.usdt -= res.cost + res.fee;
      pushPrice(a, res.fills[res.fills.length - 1].price);
      S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: "buy", price: res.avgPrice, size: res.size, usdt: res.cost + res.fee, fee: res.fee, at: now() });
    }
    const rest = size - res.size;
    if (rest > 1e-6) {
      const escrow = price * rest;
      S.me.usdt -= escrow;
      S.me.orders.unshift({ id: nextId("o"), assetId: a.id, side, price, size: rest, filled: 0, escrow, at: now() });
    }
  } else {
    const p = S.me.positions[a.id];
    need(p && p.shares - p.locked >= size - 1e-9, "可卖份额不足", "Not enough free shares");
    const res = sweep(b.bids, { maxShares: size, limit: price, side: "sell" });
    if (res.size > 0) {
      applyBookFills(a, "bids", res.fills);
      S.me.usdt += res.cost - res.fee;
      p.cost -= p.cost * (res.size / p.shares);
      moveShares(p, -res.size, a.dps);
      pushPrice(a, res.fills[res.fills.length - 1].price);
      S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: "sell", price: res.avgPrice, size: res.size, usdt: res.cost - res.fee, fee: res.fee, at: now() });
    }
    const rest = size - res.size;
    if (rest > 1e-6) {
      p.locked += rest;
      S.me.orders.unshift({ id: nextId("o"), assetId: a.id, side, price, size: rest, filled: 0, escrow: 0, at: now() });
    }
  }
  gainXp(10);
  toastL(L_("挂单已提交", "Order placed"), "good");
}

export function cancelOrder(orderId: string) {
  const o = S.me.orders.find((x) => x.id === orderId);
  need(o, "订单不存在", "Order not found");
  if (o.side === "buy") S.me.usdt += o.escrow;
  else {
    const p = S.me.positions[o.assetId];
    if (p) p.locked = Math.max(0, p.locked - (o.size - o.filled));
  }
  S.me.orders = S.me.orders.filter((x) => x.id !== orderId);
  toastL(L_("已撤单", "Order cancelled"), "info");
}

// ------------------------------------------------------------------ dividends (ShareToken.claim)

export function claimAll(assetId?: string) {
  let total = 0;
  for (const a of S.assets) {
    if (assetId && a.id !== assetId) continue;
    const p = S.me.positions[a.id];
    const amt = claimable(p, a.dps);
    if (amt <= 0) continue;
    p.withdrawn += amt;
    total += amt;
  }
  need(total > 0.0001, "暂无可领取的分红", "Nothing to claim yet");
  S.me.usdt += total;
  S.me.claimedTotal += total;
  gainXp(10);
  badge("landlord");
  ui.emit({ type: "coins", amount: total });
  toastL(L_(`已领取分红 $${total.toFixed(2)}`, `Claimed $${total.toFixed(2)} in dividends`), "good");
  return total;
}

// ------------------------------------------------------------------ confidence markets

export function bet(assetId: string, period: number, side: "yes" | "no", amount: number) {
  const a = asset(assetId);
  const m = a.markets.find((x) => x.period === period);
  need(m && !m.resolved, "这个市场已结算", "This market has settled");
  need(now() < dueDate(a.commitment, period), "已过到期日，停止下注", "Betting closed at the due date");
  need(!a.mine, "商户决定结果，不能交易自己的信心市场", "You decide this outcome, so you can't trade it");
  need(amount >= 1, "最低 $1", "Minimum is $1");
  need(amount <= S.me.usdt + 1e-9, "USDT 余额不足", "Not enough USDT");
  S.me.usdt -= amount;
  if (side === "yes") {
    m.yes += amount;
    m.myYes += amount;
  } else {
    m.no += amount;
    m.myNo += amount;
  }
  S.me.bets.unshift({ id: nextId("b"), assetId, period, side, amount, at: now() });
  feed("bet", mePerson(), a.id, amount);
  gainXp(10);
  toastL(L_(`已买入「${side === "yes" ? "会按时兑现" : "不会兑现"}」$${amount}`, `Bought ${side === "yes" ? "YES" : "NO"} for $${amount}`), "good");
}

export function claimBet(assetId: string, period: number) {
  const a = asset(assetId);
  const m = a.markets.find((x) => x.period === period);
  need(m && m.resolved, "市场尚未结算", "Not settled yet");
  need(!m.claimed, "已经领取过了", "Already claimed");
  const payout = myPayout(m);
  m.claimed = true;
  S.me.usdt += payout;
  if ((m.resolved === "yes" && m.myYes > 0) || (m.resolved === "no" && m.myNo > 0)) badge("oracle");
  if (payout > 0) ui.emit({ type: "coins", amount: payout });
  toastL(L_(`已领取 $${payout.toFixed(2)}`, `Claimed $${payout.toFixed(2)}`), payout > 0 ? "good" : "info");
}

// ------------------------------------------------------------------ public Q&A

export function ask(assetId: string, text: string) {
  const a = asset(assetId);
  need(text.trim().length >= 6, "问题至少 6 个字", "Questions need at least 6 characters");
  need(!a.mine, "这是你的生意，请在商户中心回答问题", "This is your business; answer questions in the merchant center");
  a.qa.unshift({ id: nextId("q"), author: mePerson(), mine: true, text: { zh: text.trim(), en: text.trim() }, at: now(), votes: 1, voted: true, evasive: 0 });
  S.me.asked += 1;
  feed("ask", mePerson(), a.id);
  gainXp(15);
  if (S.me.asked >= 3) badge("hunter");
  toastL(L_("问题已公开，商户需在 72 小时内回答", "Posted. The merchant must answer within 72 hours."), "good");
}

export function upvote(assetId: string, qid: string) {
  const q = asset(assetId).qa.find((x) => x.id === qid);
  if (!q) return;
  q.voted = !q.voted;
  q.votes += q.voted ? 1 : -1;
}

export function markEvasive(assetId: string, qid: string) {
  const q = asset(assetId).qa.find((x) => x.id === qid);
  if (!q || !q.answer) return;
  q.markedEvasive = !q.markedEvasive;
  q.evasive += q.markedEvasive ? 1 : -1;
}

// ------------------------------------------------------------------ merchant

export function updateDraft(patch: Partial<Draft>) {
  Object.assign(S.draft, patch);
}

export function addDraftDoc(kind: DocKind, name: string, hash: string) {
  S.draft.docs = S.draft.docs.filter((d) => d.kind !== kind || kind === "other");
  S.draft.docs.push({ id: nextId("d"), kind, name: { zh: name, en: name }, hash, at: now(), verified: false });
}

function symbolFor(name: string): string {
  const letters = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  let sym = letters.length >= 2 ? letters.map((w) => w[0]).join("").slice(0, 4) : (letters[0] ?? "BIZ").slice(0, 4);
  sym = sym.toUpperCase().padEnd(3, "X");
  let candidate = sym;
  let n = 2;
  while (S.assets.some((a) => a.symbol === candidate)) candidate = sym.slice(0, 3) + n++;
  return candidate;
}

const HUE: Record<Category, number> = {
  bar: 14, restaurant: 352, cafe: 28, teashop: 330, music: 262, ecommerce: 168, game: 300, creator: 120, energy: 46, hotel: 88, carwash: 196, ev: 222,
};

/** SliceHub.submitAsset */
export function submitApplication(): string {
  const d = S.draft;
  need(d.name.trim() && d.city.trim() && d.ownerName.trim(), "请填写生意名称、城市和负责人", "Fill in the business name, city and owner");
  const t = now();
  const sharesForSale = d.target; // $1 per share at launch
  const symbol = symbolFor(d.name);
  const id = symbol.toLowerCase();
  const a: Asset = {
    id,
    symbol,
    name: d.name.trim(),
    tagline: L_(`${d.city} · 出让 ${d.companyPct}% ${instrumentZh(d.instrument)}`, `${d.city} · ${d.companyPct}% ${instrumentEn(d.instrument)}`),
    about: { zh: d.about || `${d.name} 正在申请上链。`, en: d.about || `${d.name} is applying to go on-chain.` },
    terms: L_(
      `${d.companyPct}% ${instrumentZh(d.instrument)} · 每 ${d.periodDays} 天分红 $${d.perPeriod.toLocaleString()} · 保证金 ${d.bondPeriods} 期`,
      `${d.companyPct}% ${instrumentEn(d.instrument)} · $${d.perPeriod.toLocaleString()} every ${d.periodDays} days · ${d.bondPeriods}-period bond`,
    ),
    category: d.category,
    country: d.country,
    city: { zh: d.city, en: d.city },
    hue: HUE[d.category],
    owner: { name: d.ownerName, title: L_("所有人", "owner"), since: new Date(t).getFullYear() - 3 },
    instrument: d.instrument,
    companyPct: d.companyPct,
    stage: "review",
    qaEndsAt: null,
    listedAt: null,
    offering: {
      price: 1,
      sharesForSale,
      minRaise: Math.round((d.target * d.minRaisePct) / 100),
      sold: 0,
      raised: 0,
      investors: 0,
      opensAt: 0,
      deadline: 0,
      settleDeadline: null,
      agreementHash: null,
      agreementAt: null,
      registrationProof: null,
      proofUploadedAt: null,
      deliveredAt: null,
      confirmDays: 7,
      settleDays: 30,
      feeBps: 300,
      merchantReceived: 0,
    },
    commitment: {
      perPeriod: d.perPeriod,
      periodDays: d.periodDays,
      firstDue: 0,
      numPeriods: d.numPeriods,
      graceDays: 7,
      bond: 0,
      status: Array.from({ length: d.numPeriods }, () => "pending"),
      paid: Array.from({ length: d.numPeriods }, () => 0),
      reliability: 1,
    },
    audit: null,
    qa: [],
    docs: d.docs.map((x) => ({ ...x })),
    totalShares: 0,
    price: 1,
    history: [{ t: t - DAY, p: 1 }, { t, p: 1 }],
    intraday: [],
    dps: 0,
    distributed: 0,
    holders: 0,
    monthly: Array.from({ length: 12 }, (_, i) => Math.round(d.monthlyRevenue * (0.9 + ((i * 37) % 20) / 100))),
    margin: d.margin,
    volume24h: 0,
    markets: [],
    mine: true,
    demand: 1.4,
  };
  S.assets.unshift(a);
  S.me.merchantAssetId = id;
  return id;
}

export function instrumentZh(i: string) {
  return i === "equity" ? "股权" : i === "dividend_rights" ? "分红权" : "收入分成";
}
export function instrumentEn(i: string) {
  return i === "equity" ? "equity" : i === "dividend_rights" ? "dividend rights" : "revenue share";
}

/** SliceHub.recordAudit — then the public Q&A window opens with the agent's questions on top. */
export function applyAudit(assetId: string, audit: Audit, questions: L[]) {
  const a = asset(assetId);
  a.audit = audit;
  if (audit.verdict === "reject") {
    notice(L_("AI 尽调未通过。请根据风险项补充材料后重新提交。", "The AI review did not pass. Add the missing documents and resubmit."), "bad", a.id);
    return;
  }
  a.stage = "qa";
  a.qaEndsAt = now() + 3 * DAY;
  const t = now();
  questions.forEach((q, i) => {
    a.qa.push({ id: nextId("q"), author: { name: "AI 尽调官", country: "AI" }, ai: true, text: q, at: t - i * 1000, votes: 5 + i, evasive: 0 });
  });
  feed("listed", { name: a.owner.name, country: a.country }, a.id);
  notice(L_("AI 尽调完成，公开问答期已开启。回答完所有问题后即可开启认购。", "AI review done; public Q&A is open. Answer every question to unlock your round."), "good", a.id);
}

export function answer(assetId: string, qid: string, text: string, docName?: string) {
  const a = asset(assetId);
  need(a.mine, "只有商户本人可以回答", "Only the merchant can answer");
  need(text.trim().length >= 4, "回答太短了", "That answer is too short");
  const q = a.qa.find((x) => x.id === qid);
  need(q, "问题不存在", "Question not found");
  q.answer = { text: { zh: text.trim(), en: text.trim() }, at: now(), doc: docName || undefined };
  if (docName) {
    a.docs.push({ id: nextId("d"), kind: "other", name: { zh: docName, en: docName }, hash: fakeHash(docName + now()), at: now(), byRequest: true, verified: false } as Doc);
  }
  feed("answer", { name: a.owner.name, country: a.country }, a.id);
  gainXp(10);
}

export function unanswered(a: Asset) {
  return a.qa.filter((q) => !q.answer).length;
}

/** SliceHub.launch: post the bond and open the round. */
export function launchRound(assetId: string, durationDays: number) {
  const a = asset(assetId);
  need(a.mine, "只能开启你自己的资产", "You can only launch your own asset");
  need(a.stage === "qa", "需要先完成 AI 尽调并进入问答期", "Finish the AI review first");
  need(unanswered(a) === 0, `还有 ${unanswered(a)} 个问题未回答`, `${unanswered(a)} question(s) still unanswered`);
  const bond = a.commitment.perPeriod * (S.draft.bondPeriods || 1);
  need(S.me.usdt >= bond, `开启认购需要先存入保证金 $${bond.toLocaleString()}，USDT 余额不足`, `Opening the round needs a $${bond.toLocaleString()} bond; not enough USDT`);
  S.me.usdt -= bond;
  a.commitment.bond = bond;
  a.stage = "ipo";
  a.qaEndsAt = null;
  const t = now();
  a.offering.opensAt = t;
  a.offering.deadline = t + durationDays * DAY;
  a.commitment.firstDue = a.offering.deadline + (a.offering.settleDays + a.offering.confirmDays + a.commitment.periodDays) * DAY;
  ensureMarket(a);
  gainXp(100);
  badge("merchant");
  ui.emit({ type: "confetti" });
  feed("listed", { name: a.owner.name, country: a.country }, a.id);
}

export function signAgreement(assetId: string, hash: string) {
  const a = asset(assetId);
  need(a.mine && a.stage === "settling", "现在不需要签约", "Nothing to sign right now");
  a.offering.agreementHash = hash;
  a.offering.agreementAt = now();
  gainXp(20);
}

export function uploadRegistration(assetId: string, hash: string) {
  const a = asset(assetId);
  need(a.mine && a.stage === "settling", "现在不需要上传", "Nothing to upload right now");
  need(a.offering.agreementHash, "请先签署股份转让协议", "Sign the share transfer agreement first");
  a.offering.registrationProof = hash;
  a.offering.proofUploadedAt = now();
  notice(L_("工商变更证明已提交，平台审核员核验后即完成交割（演示中约 1 天，或在「平台审核台」立即处理）。", "Registry proof submitted. A platform verifier will check it (about a day in the demo, or right away from the Verifier desk)."), "info", a.id);
}

/** EscrowOffering.attestRegistration, from the verifier desk. */
export function attest(assetId: string) {
  const a = asset(assetId);
  need(a.stage === "settling" && a.offering.registrationProof && !a.offering.deliveredAt, "没有待核验的登记证明", "No registry proof waiting");
  need(!a.offering.settleDeadline || now() <= a.offering.settleDeadline, "已超过交割期限", "Past the settlement deadline");
  deliver(a, now());
  toastL(L_(`已核验 ${a.name} 的登记证明，进入交割`, `Verified ${a.name}'s registry proof; delivery done`), "good");
}

/** EscrowOffering.resolveDispute, from the arbitrator desk. */
export function resolveDispute(orderId: string, refundIt: boolean) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  need(e && e.state === "disputed", "没有这个仲裁", "No such dispute");
  const a = asset(e.assetId);
  if (refundIt) {
    e.state = "refunded";
    e.closedAt = now();
    S.me.usdt += e.paid;
    notice(L_(`仲裁结果：${a.name} 订单全额退款 $${e.paid.toFixed(2)}。`, `Arbitration: your ${a.name} order was refunded ($${e.paid.toFixed(2)}).`), "good", a.id);
  } else {
    e.state = "active";
    confirmOrder(e.id, false);
    notice(L_(`仲裁结果：${a.name} 交割有效，份额已到账，款项放给商户。`, `Arbitration: ${a.name}'s delivery stands; shares delivered and payment released.`), "info", a.id);
  }
}

export function payDividend(assetId: string, period: number) {
  const a = asset(assetId);
  const c = a.commitment;
  need(a.mine, "只能为自己的资产付款", "You can only pay your own asset");
  need(a.stage === "trading", "交割完成后才能分红", "Dividends start after delivery");
  need(c.status[period] === "pending", "这一期已结算", "This period is settled");
  need(S.me.usdt >= c.perPeriod, "USDT 余额不足", "Not enough USDT");
  S.me.usdt -= c.perPeriod;
  recordPayment(a, period, now());
  processLifecycle();
  gainXp(30);
  ui.emit({ type: "confetti" });
  toastL(
    L_(`第 ${period + 1} 期分红 $${c.perPeriod.toLocaleString()} 已按持股分给全部持有人`, `Period ${period + 1}: $${c.perPeriod.toLocaleString()} split across every holder`),
    "good",
  );
}

export function raiseCommitment(assetId: string, newAmount: number) {
  const a = asset(assetId);
  const c = a.commitment;
  need(a.mine, "只能修改自己的承诺", "You can only change your own promise");
  need(newAmount > c.perPeriod, "新承诺必须更高", "The new promise must be higher");
  const topUp = Math.max(0, newAmount - c.bond);
  need(S.me.usdt >= topUp, `需要追加保证金 $${topUp.toLocaleString()}`, `Needs $${topUp.toLocaleString()} more bond`);
  S.me.usdt -= topUp;
  c.bond += topUp;
  c.perPeriod = newAmount;
  pushPrice(a, a.price * 1.04);
  toastL(L_(`承诺已提高到每期 $${newAmount.toLocaleString()}，保证金同步追加`, `Promise raised to $${newAmount.toLocaleString()} per period; bond topped up`), "good");
}

// ------------------------------------------------------------------ time & settings

export function fastForward(days: number) {
  const events = advance(days);
  toastL(
    L_(`时间快进 ${days} 天${events ? `，发生了 ${events} 件事，查看通知` : ""}`, `Skipped ahead ${days} days${events ? `; ${events} things happened, see notifications` : ""}`),
    "info",
  );
}

export function resetDraft() {
  S.draft = defaultDraft();
}

export function markNoticesRead() {
  S.notices.forEach((n) => (n.read = true));
}
