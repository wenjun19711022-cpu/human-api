/**
 * Leaderboards. Each one ranks a behavior that makes the market more honest, never raw volume:
 * - 先知榜 Oracles: settled confidence-market P&L (being right about payouts prices risk for everyone).
 * - 尽调猎人榜 Hunters: questions other people upvoted, that forced a document, or exposed a dodge.
 * - 收租榜 Landlords: dividends actually received, not shares held or money spent.
 */
import type { Asset, ConfMarket, Me, Person, Rival } from "./types";
import { claimable, payoutOf } from "./market";

export interface Row {
  who: Person;
  me?: boolean;
  score: number;
  detail: { a: number; b: number }; // oracle: hits/n · hunter: docs/dodges · landlord: assets held
}

export const MIN_ORACLE_CALLS = 3; // fewer settled calls than this is luck, not skill
export const HUNTER = { DOC: 20, DODGE: 30, DODGE_FLAGS: 3 } as const;

/** Points for one question. Asking costs nothing, so asking alone earns nothing. */
export function questionPoints(q: { votes: number; voted?: boolean; mine?: boolean; evasive: number; answer?: { doc?: string } }): number {
  const others = Math.max(0, q.votes - (q.mine && q.voted ? 1 : 0)); // your own upvote doesn't count
  let pts = others;
  if (q.answer?.doc) pts += HUNTER.DOC;
  if (q.evasive >= HUNTER.DODGE_FLAGS) pts += HUNTER.DODGE;
  return pts;
}

export function hunterBoard(assets: Asset[], me: Person): Row[] {
  const rows = new Map<string, Row>();
  for (const a of assets) {
    for (const q of a.qa) {
      if (q.ai) continue;
      const key = q.mine ? "\u0000me" : q.author.name;
      const row = rows.get(key) ?? { who: q.mine ? me : q.author, me: !!q.mine, score: 0, detail: { a: 0, b: 0 } };
      row.score += questionPoints(q);
      if (q.answer?.doc) row.detail.a += 1;
      if (q.evasive >= HUNTER.DODGE_FLAGS) row.detail.b += 1;
      rows.set(key, row);
    }
  }
  return rank([...rows.values()]);
}

/** My settled confidence-market record, read straight from the pools (ConfidenceMarket.payoutOf). */
export function myOracle(assets: Asset[]): { n: number; hits: number; pnl: number } {
  const r = { n: 0, hits: 0, pnl: 0 };
  for (const a of assets) {
    for (const m of a.markets) {
      const stake = m.myYes + m.myNo;
      if (!m.resolved || stake <= 0) continue;
      const pay = payoutOf(m, m.myYes, m.myNo);
      r.n += 1;
      if (pay > stake + 1e-9) r.hits += 1;
      r.pnl += pay - stake;
    }
  }
  return r;
}

/** Settle a rival's stakes when a market resolves. */
export function settleRivalBets(rivals: Rival[], assetId: string, m: ConfMarket) {
  for (const r of rivals) {
    const mine = r.bets.filter((b) => b.assetId === assetId && b.period === m.period);
    if (!mine.length) continue;
    const yes = mine.filter((b) => b.side === "yes").reduce((s, b) => s + b.amount, 0);
    const no = mine.filter((b) => b.side === "no").reduce((s, b) => s + b.amount, 0);
    const pay = payoutOf(m, yes, no);
    r.oracle.n += 1;
    if (pay > yes + no + 1e-9) r.oracle.hits += 1;
    r.oracle.pnl += pay - yes - no;
    r.bets = r.bets.filter((b) => !(b.assetId === assetId && b.period === m.period));
  }
}

export function oracleBoard(rivals: Rival[], assets: Asset[], me: Person): Row[] {
  const mine = myOracle(assets);
  const all: Row[] = rivals.map((r) => ({ who: r, score: r.oracle.pnl, detail: { a: r.oracle.hits, b: r.oracle.n } }));
  all.push({ who: me, me: true, score: mine.pnl, detail: { a: mine.hits, b: mine.n } });
  return rank(all.filter((r) => r.detail.b >= MIN_ORACLE_CALLS || r.me));
}

/** Dividends received so far: claimed + still claimable. Mirrors ShareToken.accumulativeDividendOf. */
export function received(positions: Record<string, { shares: number; corr: number; withdrawn: number; locked: number; cost: number }>, assets: Asset[]): number {
  let total = 0;
  for (const a of assets) {
    const p = positions[a.id];
    if (p) total += p.withdrawn + claimable(p, a.dps);
  }
  return total;
}

export function landlordBoard(rivals: Rival[], assets: Asset[], me: Me, mePerson: Person): Row[] {
  const held = (pos: Record<string, { shares: number }>) => Object.values(pos).filter((p) => p.shares > 1e-6).length;
  const all: Row[] = rivals.map((r) => ({ who: r, score: received(r.positions, assets), detail: { a: held(r.positions), b: 0 } }));
  all.push({ who: mePerson, me: true, score: received(me.positions, assets), detail: { a: held(me.positions), b: 0 } });
  return rank(all.filter((r) => r.score > 0.005 || r.me));
}

function rank(rows: Row[]): Row[] {
  return rows.sort((x, y) => y.score - x.score || (x.me ? -1 : 0) - (y.me ? -1 : 0));
}
