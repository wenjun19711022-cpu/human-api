/**
 * Pure market math. Every rule here mirrors a contract in slice/contracts/src so the demo behaves like the
 * chain: ShareToken dividends, ShareExchange taker fees and sweep order, ConfidenceMarket parimutuel payouts.
 */
import type { Asset, BookLevel, Clearing, Commitment, ConfMarket, Offering, Position } from "./types";
import { TIME } from "../lib/format";

export const TAKER_FEE = 0.005; // ShareExchange takerFeeBps = 50
export const UPFRONT_FEE_BPS = 100; // SliceHub.upfrontFeeBps
export const VESTED_FEE_BPS = 200; // SliceHub.vestedFeeBps
export const CANCEL_CUTOFF_DAYS = 2; // EscrowOffering.CANCEL_CUTOFF
export const DISPUTE_BOND_BPS = 200; // EscrowOffering.DISPUTE_BOND_BPS
export const ARBITRATION_DAYS = 14; // EscrowOffering.ARBITRATION_WINDOW
export const CONF_FEE = 0.02; // ConfidenceMarket feeBps = 200

export const round2 = (x: number) => Math.round(x * 100) / 100;
export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ------------------------------------------------------------------ launch round (EscrowOffering)

/** Price ladder: floor, then +tickBps per step. One step = fixed price. */
export function ladder(floor: number, tickBps: number, n: number): number[] {
  const out: number[] = [];
  let p = floor;
  for (let i = 0; i < n; i++) {
    out.push(p);
    p = (p * (10_000 + tickBps)) / 10_000;
  }
  return out;
}

/** Mirrors EscrowOffering.previewClearing: one uniform price for everybody. */
export function clear(prices: number[], tickBudget: number[], supply: number): Clearing {
  let above = 0;
  for (let t = prices.length - 1; t >= 0; t--) {
    const withTick = above + tickBudget[t];
    if (withTick / prices[t] >= supply - 1e-9) {
      let price = Math.max(prices[t], above / supply);
      let marginal = 0;
      if (price <= prices[t] * (1 + 1e-12)) {
        price = prices[t];
        const left = supply - above / price;
        marginal = Math.min(left * price, tickBudget[t]);
      }
      return { tick: t, price, atFloor: false, marginal, raised: above + marginal };
    }
    above = withTick;
  }
  return { tick: 0, price: prices[0], atFloor: true, marginal: tickBudget[0], raised: above };
}

export function previewClearing(o: Offering): Clearing {
  return o.clearing ?? clear(o.prices, o.tickBudget, o.sharesForSale);
}

/** Mirrors EscrowOffering.allocation: what a bid fills at the clearing price. */
export function allocation(o: Offering, bid: { budget: number; tick: number }): { cost: number; shares: number } {
  const c = previewClearing(o);
  let cost = 0;
  if (c.atFloor || bid.tick > c.tick) cost = bid.budget;
  else if (bid.tick === c.tick && c.marginal > 0) cost = (bid.budget * c.marginal) / o.tickBudget[c.tick];
  return { cost, shares: cost / c.price };
}

/** Demand at the floor price relative to supply (1.2 = 1.2x oversubscribed). */
export function coverage(o: Offering): number {
  return o.committed / o.prices[0] / o.sharesForSale;
}

export function raisedOf(o: Offering): number {
  return previewClearing(o).raised;
}

/** Mirrors SliceHub.requiredBondPeriods: A 1, B 2, C 3, below 4, +1 per default on record. */
export function requiredBondPeriods(score: number, defaults: number): number {
  const base = score >= 85 ? 1 : score >= 75 ? 2 : score >= 60 ? 3 : 4;
  return base + defaults;
}

// ------------------------------------------------------------------ commitment

export function dueDate(c: Commitment, i: number): number {
  return c.firstDue + i * c.periodDays * TIME.DAY;
}

export function nextPending(c: Commitment): number {
  const i = c.status.indexOf("pending");
  return i === -1 ? c.numPeriods : i;
}

export function annualPayout(a: Asset): number {
  return (a.commitment.perPeriod * 365) / a.commitment.periodDays;
}

/** Shares the promised payout is split across (issued supply once trading, offered supply before). */
export function shareBase(a: Asset): number {
  return a.totalShares > 0 ? a.totalShares : a.offering.sharesForSale;
}

/** Promised cash yield at a given share price. */
export function yieldAt(a: Asset, price = a.price): number {
  return annualPayout(a) / (price * shareBase(a));
}

export function perShareDividend(a: Asset): number {
  return a.commitment.perPeriod / shareBase(a);
}

/** Implied value of 100% of the business (equity) or of the whole note (revenue share). */
export function impliedValuation(a: Asset): number {
  const cap = a.price * shareBase(a);
  return a.instrument === "equity" ? cap / (a.companyPct / 100) : cap;
}

export function record(c: Commitment) {
  const count = (s: string) => c.status.filter((x) => x === s).length;
  return { paid: count("paid"), late: count("late"), defaulted: count("defaulted"), settled: c.status.filter((s) => s !== "pending").length };
}

/** Mirrors CommitmentVault.isResolved. */
export function isResolved(c: Commitment, i: number, now: number): { resolved: boolean; honored: boolean } {
  const s = c.status[i];
  if (s === "paid") return { resolved: true, honored: true };
  if (s === "late" || s === "defaulted") return { resolved: true, honored: false };
  if (now > dueDate(c, i) + c.graceDays * TIME.DAY) return { resolved: true, honored: false };
  return { resolved: false, honored: false };
}

// ------------------------------------------------------------------ dividends (ShareToken)

export function emptyPosition(): Position {
  return { shares: 0, locked: 0, cost: 0, corr: 0, withdrawn: 0 };
}

export function claimable(pos: Position | undefined, dps: number): number {
  if (!pos) return 0;
  return Math.max(0, round6(pos.shares * dps + pos.corr - pos.withdrawn));
}

/** Change a balance while keeping already-earned dividends with the previous owner. */
export function moveShares(pos: Position, delta: number, dps: number) {
  pos.shares = round6(pos.shares + delta);
  pos.corr -= dps * delta;
}

// ------------------------------------------------------------------ order book (ShareExchange)

export interface Fill {
  price: number;
  size: number;
  mine?: string;
}

export interface SweepResult {
  fills: Fill[];
  size: number; // shares
  cost: number; // USDT before fee
  fee: number;
  avgPrice: number;
}

/**
 * Walk `levels` (best first) like ShareExchange._takeAsks/_takeBids.
 * Buy side: stop when `budget` (fee included) runs out. Sell side: stop after `maxShares`.
 */
export function sweep(levels: BookLevel[], opts: { budget?: number; maxShares?: number; limit?: number; side: "buy" | "sell" }): SweepResult {
  const fills: Fill[] = [];
  let size = 0;
  let cost = 0;
  let fee = 0;
  for (const lv of levels) {
    if (opts.limit !== undefined) {
      if (opts.side === "buy" && lv.price > opts.limit) break;
      if (opts.side === "sell" && lv.price < opts.limit) break;
    }
    let take = lv.size;
    if (opts.maxShares !== undefined) take = Math.min(take, opts.maxShares - size);
    if (opts.budget !== undefined) {
      const left = opts.budget - cost - fee;
      const affordable = left / (1 + TAKER_FEE) / lv.price;
      take = Math.min(take, affordable);
    }
    take = Math.floor(take * 1e6) / 1e6;
    if (take <= 0) break;
    const c = take * lv.price;
    fills.push({ price: lv.price, size: take, mine: lv.mine });
    size += take;
    cost += c;
    fee += c * TAKER_FEE;
    if (take < lv.size) break;
  }
  return { fills, size, cost, fee, avgPrice: size ? cost / size : 0 };
}

/** Synthetic resting liquidity around `mid` (bot market makers). */
export function makeBook(mid: number, depth: number, notional: number, r: () => number): { bids: BookLevel[]; asks: BookLevel[] } {
  const spread = 0.006 + r() * 0.006;
  const asks: BookLevel[] = [];
  const bids: BookLevel[] = [];
  for (let k = 0; k < depth; k++) {
    const step = 0.004 + r() * 0.004;
    const ap = mid * (1 + spread / 2 + k * step);
    const bp = mid * (1 - spread / 2 - k * step);
    const sizeFor = (p: number) => Math.round(((notional * (0.4 + r() * 1.2) * (1 + k * 0.35)) / p) * 100) / 100;
    asks.push({ price: roundTick(ap), size: sizeFor(ap) });
    if (bp > 0.01) bids.push({ price: roundTick(bp), size: sizeFor(bp) });
  }
  return { bids, asks };
}

export function roundTick(p: number): number {
  const tick = p >= 1 ? 0.01 : 0.001;
  return Math.round(p / tick) * tick;
}

/** Merge my resting orders into the bot book, best price first, time priority to existing levels. */
export function mergeBook(
  bot: { bids: BookLevel[]; asks: BookLevel[] },
  mine: { id: string; side: "buy" | "sell"; price: number; remaining: number }[],
) {
  const bids = [...bot.bids];
  const asks = [...bot.asks];
  for (const o of mine) {
    const lv = { price: o.price, size: o.remaining, mine: o.id };
    if (o.side === "buy") bids.push(lv);
    else asks.push(lv);
  }
  bids.sort((a, b) => b.price - a.price || (a.mine ? 1 : 0) - (b.mine ? 1 : 0));
  asks.sort((a, b) => a.price - b.price || (a.mine ? 1 : 0) - (b.mine ? 1 : 0));
  return { bids, asks };
}

// ------------------------------------------------------------------ confidence markets (parimutuel)

export function yesPrice(m: ConfMarket): number {
  const t = m.yes + m.no;
  return t === 0 ? 0.5 : m.yes / t;
}

/** What `amount` on `side` pays if that side wins, given current pools. */
export function potentialPayout(m: ConfMarket, side: "yes" | "no", amount: number): number {
  const winning = (side === "yes" ? m.yes : m.no) + amount;
  const losing = side === "yes" ? m.no : m.yes;
  return amount + (amount * losing * (1 - CONF_FEE)) / winning;
}

/** Mirrors ConfidenceMarket.payoutOf for any holder's stakes after resolution. */
export function payoutOf(m: ConfMarket, yesStake: number, noStake: number): number {
  if (!m.resolved) return 0;
  const yesWon = m.resolved === "yes";
  const winning = yesWon ? m.yes : m.no;
  const losing = yesWon ? m.no : m.yes;
  const stake = yesWon ? yesStake : noStake;
  if (winning === 0) return yesWon ? noStake : yesStake; // nobody to pay: everyone refunded
  if (stake === 0) return 0;
  return stake + (stake * losing * (1 - CONF_FEE)) / winning;
}

export function myPayout(m: ConfMarket): number {
  return payoutOf(m, m.myYes, m.myNo);
}

// ------------------------------------------------------------------ price stats

export function change(history: { t: number; p: number }[], now: number, window: number, current: number): number {
  const from = now - window;
  let base = history[0]?.p ?? current;
  for (const pt of history) {
    if (pt.t <= from) base = pt.p;
    else break;
  }
  return base ? current / base - 1 : 0;
}
