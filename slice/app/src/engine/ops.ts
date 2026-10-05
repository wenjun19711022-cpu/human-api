/** Shared state transitions used by both user actions and the simulation. Each mirrors a contract function. */
import type { Asset, ConfMarket, EscrowOrder, FeedKind, L, Person } from "./types";
import { S, botBook, nextId, now, refreshBook, ui } from "./store";
import { settleRivalBets } from "./board";
import {
  allocation,
  clear,
  claimable,
  dueDate,
  emptyPosition,
  isResolved,
  moveShares,
  nextPending,
  sweep,
  yesPrice,
} from "./market";
import { TIME } from "../lib/format";
import { hashString, mulberry32, rng } from "../lib/rand";

const DAY = TIME.DAY;
const L_ = (zh: string, en: string): L => ({ zh, en });

export const LEVELS = [0, 100, 300, 700, 1500, 3000, 6000, 12000];
export const LEVEL_NAMES: L[] = [
  L_("新手股东", "Rookie owner"),
  L_("街角股东", "Corner-shop owner"),
  L_("城市股东", "City owner"),
  L_("环球股东", "Globe trotter"),
  L_("跨国大亨", "Tycoon"),
  L_("世界股东", "World owner"),
  L_("传奇股东", "Legend"),
  L_("传奇股东", "Legend"),
];

export function levelOf(xp: number): number {
  let lv = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lv = i;
  return lv;
}

export const BADGES: Record<string, { name: L; desc: L }> = {
  first: { name: L_("首单", "First slice"), desc: L_("第一次买入任何生意", "Bought your first slice of anything") },
  early: { name: L_("早鸟", "Early bird"), desc: L_("参与一次首发认购", "Joined a launch round") },
  global: { name: L_("环球股东", "Globe owner"), desc: L_("持有 3 个国家的生意", "Own businesses in 3 countries") },
  hunter: { name: L_("尽调猎人", "Due-diligence hunter"), desc: L_("公开提问 3 次", "Asked 3 public questions") },
  landlord: { name: L_("收租人", "Rent collector"), desc: L_("第一次领取分红", "Claimed your first dividend") },
  compounder: { name: L_("复利玩家", "Compounder"), desc: L_("用分红复投买入更多份额", "Reinvested dividends into more shares") },
  oracle: { name: L_("先知", "Oracle"), desc: L_("在信心市场猜对一次", "Called a confidence market right") },
  merchant: { name: L_("上链商户", "On-chain merchant"), desc: L_("把自己的生意推上链", "Took your own business on-chain") },
  receipt: { name: L_("确认收货", "Delivered"), desc: L_("确认收货，资金放给商户", "Confirmed receipt and released escrow") },
};

export function mePerson(): Person {
  return { name: S.lang === "zh" ? "你" : "You", country: S.me.country };
}

export function gainXp(n: number) {
  const before = levelOf(S.me.xp);
  S.me.xp += n;
  const after = levelOf(S.me.xp);
  if (after > before) ui.emit({ type: "level", level: after });
}

export function badge(id: string) {
  if (S.me.badges.includes(id)) return;
  S.me.badges.push(id);
  ui.emit({ type: "badge", id });
}

export function notice(text: L, tone: "good" | "info" | "warn" | "bad", assetId?: string) {
  S.notices.unshift({ id: nextId("n"), at: now(), text, tone, assetId, read: false });
  if (S.notices.length > 60) S.notices.length = 60;
}

export function feed(kind: FeedKind, who: Person, assetId: string, amount?: number) {
  S.feed.unshift({ id: nextId("f"), at: now(), kind, who, assetId, amount });
  if (S.feed.length > 80) S.feed.length = 80;
}

export function holdsAsset(a: Asset): boolean {
  const p = S.me.positions[a.id];
  return !!p && p.shares > 1e-9;
}

export function countriesOwned(): string[] {
  const set = new Set<string>();
  for (const a of S.assets) if (holdsAsset(a)) set.add(a.country);
  return [...set];
}

export function checkGlobal() {
  if (countriesOwned().length >= 3) badge("global");
}

export function pushPrice(a: Asset, p: number, t = now()) {
  a.price = Math.max(0.01, p);
  a.intraday.push({ t, p: a.price });
  if (a.intraday.length > 160) a.intraday.splice(0, a.intraday.length - 160);
}

const merchantOf = (a: Asset): Person => ({ name: a.owner.name, country: a.country });

// ------------------------------------------------------------------ round lifecycle (EscrowOffering)

export function openRound(a: Asset, t: number, durationDays = 21) {
  a.stage = "ipo";
  a.qaEndsAt = null;
  a.offering.opensAt = t;
  a.offering.deadline = t + durationDays * DAY;
  a.commitment.firstDue = a.offering.deadline + (a.offering.settleDays + a.offering.confirmDays + a.commitment.periodDays) * DAY;
  ensureMarket(a);
  feed("listed", merchantOf(a), a.id);
}

/** Add USDT at a tick of the round's price ladder (EscrowOffering.bid). */
export function addBid(a: Asset, tick: number, amount: number) {
  a.offering.tickBudget[tick] += amount;
  a.offering.committed += amount;
}

/** close(): one clearing price for everyone; settlement window counts from the deadline. */
export function closeRound(a: Asset) {
  const o = a.offering;
  const c = clear(o.prices, o.tickBudget, o.sharesForSale);
  o.clearing = c;
  o.price = c.price;
  if (c.raised >= o.minRaise && c.raised > 0) {
    a.stage = "settling";
    o.settleDeadline = o.deadline + o.settleDays * DAY;
    const mine = S.me.escrow.find((e) => e.assetId === a.id && e.state === "active");
    if (mine) {
      const fill = allocation(o, mine);
      const unfilled = mine.budget - fill.cost;
      notice(
        L_(
          `${a.name} 认购截止，统一清算价 $${c.price.toFixed(4)}。你成交 $${fill.cost.toFixed(2)}${unfilled > 0.005 ? `，未成交的 $${unfilled.toFixed(2)} 可立即取回` : ""}。`,
          `${a.name} closed at a uniform $${c.price.toFixed(4)}. You filled $${fill.cost.toFixed(2)}${unfilled > 0.005 ? `; the unfilled $${unfilled.toFixed(2)} can be withdrawn now` : ""}.`,
        ),
        "good",
        a.id,
      );
    }
    if (a.mine) {
      notice(L_(`认购已成团，统一价 $${c.price.toFixed(4)}，共 $${Math.round(c.raised).toLocaleString()}。请在 30 天内签署转让协议并上传工商变更证明。`, `Your round filled at $${c.price.toFixed(4)}, $${Math.round(c.raised).toLocaleString()} in total. Sign the transfer agreement and upload the registry change within 30 days.`), "good", a.id);
    }
  } else {
    failRound(a, L_("未达到最低募资额", "minimum raise not reached"));
  }
}

export function failRound(a: Asset, why: L) {
  a.stage = "failed";
  if (S.me.escrow.some((e) => e.assetId === a.id && e.state === "active")) {
    notice(L_(`${a.name} 认购失败（${why.zh}），你的 USDT 可全额退回。`, `${a.name} round failed (${why.en}). Your USDT is fully refundable.`), "warn", a.id);
  }
  if (a.mine) {
    S.me.usdt += a.commitment.bond;
    notice(L_(`认购失败（${why.zh}），保证金 $${a.commitment.bond} 已退回。`, `Round failed (${why.en}); your $${a.commitment.bond} bond was returned.`), "warn", a.id);
    a.commitment.bond = 0;
  }
}

export function myEscrowCost(assetId: string): number {
  const a = S.assets.find((x) => x.id === assetId);
  if (!a) return 0;
  return S.me.escrow.filter((e) => e.assetId === assetId && e.state !== "refunded").reduce((s, e) => s + allocation(a.offering, e).cost, 0);
}

/** attestRegistration: the round is delivered and the shares go live. */
export function deliver(a: Asset, t: number) {
  const o = a.offering;
  const c = o.clearing!;
  o.deliveredAt = t;
  a.stage = "trading";
  a.listedAt = t;
  a.totalShares = c.raised / c.price;
  a.price = c.price;
  a.history = [
    { t: t - DAY, p: c.price },
    { t, p: c.price },
  ];
  a.intraday = [{ t, p: c.price }];
  a.holders = Math.max(a.holders, o.investors);
  refreshBook(a);
  ensureMarket(a);
  feed("delivered", merchantOf(a), a.id);
  if (S.me.escrow.some((e) => e.assetId === a.id && e.state === "active")) {
    notice(L_(`${a.name} 股权登记已核验，请确认收货领取份额（7 天后自动确认）。`, `${a.name}'s registry change is verified. Confirm receipt to get your shares (auto-confirms in 7 days).`), "good", a.id);
  }
  if (a.mine) {
    const others = c.raised - myEscrowCost(a.id);
    const net = payMerchant(a, others * 0.6);
    notice(L_(`平台已核验工商变更。已有投资人确认收货，$${Math.round(net).toLocaleString()} 已到账（已扣 1% 平台费，另 2% 锁在金库按期兑现）。`, `Registry change verified. Investors are confirming receipt; $${Math.round(net).toLocaleString()} has arrived (after the 1% fee; another 2% vests in the vault).`), "good", a.id);
  }
}

/** Release `gross` investor money: 1% to the platform now, 2% into the vault, the rest to the merchant. */
export function payMerchant(a: Asset, gross: number): number {
  const o = a.offering;
  const vested = (gross * o.vestedBps) / 10_000;
  const net = gross - (gross * o.upfrontBps) / 10_000 - vested;
  depositPlatformFee(a, vested);
  o.merchantReceived += net;
  if (a.mine) S.me.usdt += net;
  return net;
}

/** 确认收货: shares at the clearing price, money to the merchant, unfilled remainder back to the investor. */
export function confirmOrder(orderId: string, auto: boolean) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  if (!e || e.state !== "active") return;
  const a = S.assets.find((x) => x.id === e.assetId)!;
  const { cost, shares } = allocation(a.offering, e);
  const leftover = e.budget - cost - e.withdrawn;
  e.state = "confirmed";
  e.closedAt = now();
  e.auto = auto;
  e.withdrawn += leftover;
  S.me.usdt += leftover;
  if (shares > 0) {
    const p = (S.me.positions[a.id] ??= emptyPosition());
    moveShares(p, shares, a.dps);
    p.cost += cost;
  }
  payMerchant(a, cost);
  checkGlobal();
}

export function refundOrder(e: EscrowOrder) {
  const amount = e.budget - e.withdrawn + (e.disputeBond ?? 0);
  e.withdrawn = e.budget;
  e.disputeBond = 0;
  e.state = "refunded";
  e.closedAt = now();
  S.me.usdt += amount;
  return amount;
}

// ------------------------------------------------------------------ commitments (CommitmentVault)

export function distribute(a: Asset, amount: number) {
  if (a.totalShares <= 0 || amount <= 0) return;
  a.dps += amount / a.totalShares;
  a.distributed += amount;
}

export function depositPlatformFee(a: Asset, amount: number) {
  const c = a.commitment;
  if (c.settled >= c.numPeriods) c.feeToPlatform += amount;
  else c.feeRemaining += amount;
}

/** One slice of the vested fee per settled period: to the platform if honoured, else to holders. */
function settleFee(a: Asset, honored: boolean) {
  const c = a.commitment;
  const left = c.numPeriods - c.settled;
  c.settled += 1;
  if (c.feeRemaining <= 0) return;
  const slice = left === 1 ? c.feeRemaining : c.feeRemaining / left;
  c.feeRemaining -= slice;
  if (honored) c.feeToPlatform += slice;
  else {
    c.feeToHolders += slice;
    distribute(a, slice);
  }
}

function settlePaid(a: Asset, i: number, t: number) {
  const c = a.commitment;
  const onTime = t <= dueDate(c, i) + c.graceDays * DAY;
  c.status[i] = onTime ? "paid" : "late";
  c.paid[i] = c.credit[i];
  settleFee(a, onTime);
  pushPrice(a, a.price * (onTime ? 1.025 : 0.99), t);
  feed("dividend", merchantOf(a), a.id, Math.round(c.credit[i]));
  if (holdsAsset(a)) {
    const mine = S.me.positions[a.id].shares * (c.perPeriod / a.totalShares);
    notice(
      L_(
        `${a.name} 第 ${i + 1} 期承诺${onTime ? "已按时兑现" : "迟到兑现"}，本期你分到约 $${mine.toFixed(2)}，可在持仓页领取。`,
        `${a.name} period ${i + 1} ${onTime ? "honoured on time" : "honoured late"}; your share is about $${mine.toFixed(2)}. Claim it in Portfolio.`,
      ),
      onTime ? "good" : "warn",
      a.id,
    );
  }
}

/**
 * CommitmentVault.contribute: any amount, any time. Reaches holders at once and fills the earliest open period.
 * Returns how many periods it completed.
 */
export function contribute(a: Asset, amount: number, t: number): number {
  const c = a.commitment;
  distribute(a, amount);
  let left = amount;
  let completed = 0;
  for (let i = 0; i < c.numPeriods && left > 1e-9; i++) {
    if (c.status[i] !== "pending") continue;
    const take = Math.min(left, c.perPeriod - c.credit[i]);
    c.credit[i] += take;
    left -= take;
    if (c.credit[i] >= c.perPeriod - 1e-9) {
      c.credit[i] = c.perPeriod;
      settlePaid(a, i, t);
      completed++;
    }
  }
  return completed;
}

/** CommitmentVault.slash: after due + grace, the bond covers only the shortfall. */
export function slashPeriod(a: Asset, i: number, t: number) {
  const c = a.commitment;
  const missing = c.perPeriod - c.credit[i];
  const taken = Math.min(c.bond, missing);
  c.bond -= taken;
  c.status[i] = "defaulted";
  c.paid[i] = c.credit[i] + taken;
  distribute(a, taken);
  settleFee(a, false);
  pushPrice(a, a.price * 0.82, t);
  feed("default", merchantOf(a), a.id, Math.round(taken));
  if (a.mine) S.me.merchantDefaults += 1;
  if (a.audit) {
    a.audit.trustScore = Math.max(0, a.audit.trustScore - 12);
    a.audit.grade = a.audit.trustScore >= 85 ? "A" : a.audit.trustScore >= 75 ? "B" : a.audit.trustScore >= 60 ? "C" : a.audit.trustScore >= 45 ? "D" : "F";
    a.audit.flags.unshift({
      severity: "high",
      title: L_(`第 ${i + 1} 期分红违约`, `Defaulted on period ${i + 1}`),
      detail: L_(
        `宽限期结束仍差 $${Math.round(missing).toLocaleString()}，保证金补足了 $${Math.round(taken).toLocaleString()}，平台这一期的费用也让给了持有人。`,
        `$${Math.round(missing).toLocaleString()} short after the grace period; the bond covered $${Math.round(taken).toLocaleString()} and the platform forfeited this period's fee to holders.`,
      ),
    });
  }
  if (holdsAsset(a) || a.mine) {
    notice(
      L_(`${a.name} 第 ${i + 1} 期违约，保证金 $${Math.round(taken).toLocaleString()} 已自动赔付给持有人。`, `${a.name} defaulted on period ${i + 1}; $${Math.round(taken).toLocaleString()} of bond was paid to holders automatically.`),
      "bad",
      a.id,
    );
  }
}

/** Deterministic per-period decision for bot-run merchants. */
export function botWillPay(a: Asset, i: number): boolean {
  const r = mulberry32(hashString(a.id + ":" + i))();
  return r < a.commitment.reliability;
}

// ------------------------------------------------------------------ reinvest (ShareExchange.reinvest)

/** Claim dividends on `a` and buy its cheapest asks with them. Returns shares bought. */
export function reinvestAsset(a: Asset): { spent: number; shares: number } {
  const p = S.me.positions[a.id];
  const amount = claimable(p, a.dps);
  if (a.stage !== "trading" || amount < 0.01) return { spent: 0, shares: 0 };
  const b = botBook(a);
  const res = sweep(b.asks, { budget: amount, side: "buy" });
  if (res.size <= 0) return { spent: 0, shares: 0 };
  for (const f of res.fills) {
    const lv = b.asks.find((l) => Math.abs(l.price - f.price) < 1e-9);
    if (lv) lv.size -= f.size;
  }
  b.asks = b.asks.filter((l) => l.size > 1e-6);
  const spent = res.cost + res.fee;
  p.withdrawn += amount;
  S.me.claimedTotal += amount;
  S.me.usdt += amount - spent;
  moveShares(p, res.size, a.dps);
  p.cost += spent;
  S.me.reinvested += spent;
  pushPrice(a, res.fills[res.fills.length - 1].price);
  S.me.trades.unshift({ id: nextId("t"), assetId: a.id, side: "buy", price: res.avgPrice, size: res.size, usdt: spent, fee: res.fee, at: now() });
  if (b.asks.length < 3) refreshBook(a);
  return { spent, shares: res.size };
}

// ------------------------------------------------------------------ confidence markets

export function ensureMarket(a: Asset) {
  const i = nextPending(a.commitment);
  if (i >= a.commitment.numPeriods) return;
  if (a.markets.some((m) => m.period === i)) return;
  if (now() >= dueDate(a.commitment, i)) return;
  const pool = 300 + rng() * 1500;
  const belief = Math.min(0.95, Math.max(0.1, a.commitment.reliability + (rng() - 0.5) * 0.1));
  a.markets.push({ period: i, yes: pool * belief, no: pool * (1 - belief), myYes: 0, myNo: 0, resolved: null, claimed: false });
}

export function resolveMarkets(a: Asset, t: number) {
  for (const m of a.markets) {
    if (m.resolved) continue;
    const { resolved, honored } = isResolved(a.commitment, m.period, t);
    if (!resolved) continue;
    m.resolved = honored ? "yes" : "no";
    settleRivalBets(S.rivals, a.id, m);
    if (m.myYes + m.myNo > 0) {
      const won = (honored && m.myYes > 0) || (!honored && m.myNo > 0);
      notice(
        L_(`信心市场「${a.name} 第 ${m.period + 1} 期」已结算：${honored ? "按时兑现" : "未兑现"}。${won ? "你猜对了，去领取奖金。" : ""}`, `Confidence market "${a.name} period ${m.period + 1}" settled: ${honored ? "paid on time" : "not honored"}. ${won ? "You called it, claim your payout." : ""}`),
        won ? "good" : "info",
        a.id,
      );
    }
  }
  ensureMarket(a);
}

export function liveMarket(a: Asset): ConfMarket | undefined {
  return a.markets.find((m) => !m.resolved);
}

export function marketOdds(m: ConfMarket) {
  return yesPrice(m);
}
