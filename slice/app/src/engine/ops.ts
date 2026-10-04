/** Shared state transitions used by both user actions and the simulation. */
import type { Asset, ConfMarket, FeedKind, L, Person } from "./types";
import { S, nextId, now, refreshBook, ui } from "./store";
import { dueDate, emptyPosition, isResolved, moveShares, nextPending, yesPrice } from "./market";
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

// ------------------------------------------------------------------ round lifecycle (EscrowOffering)

export function openRound(a: Asset, t: number, durationDays = 21) {
  a.stage = "ipo";
  a.qaEndsAt = null;
  a.offering.opensAt = t;
  a.offering.deadline = t + durationDays * DAY;
  a.commitment.firstDue = a.offering.deadline + (a.offering.settleDays + a.offering.confirmDays + a.commitment.periodDays) * DAY;
  ensureMarket(a);
  feed("listed", { name: a.owner.name, country: a.country }, a.id);
}

export function closeRound(a: Asset, t: number) {
  const o = a.offering;
  if (o.raised >= o.minRaise && o.raised > 0) {
    a.stage = "settling";
    o.settleDeadline = t + o.settleDays * DAY;
    if (S.me.escrow.some((e) => e.assetId === a.id && e.state === "active")) {
      notice(L_(`${a.name} 认购成团！等待商户签约并完成股权登记。`, `${a.name} round filled! Waiting for the merchant to sign and register the transfer.`), "good", a.id);
    }
    if (a.mine) {
      notice(L_("认购已成团，请在 30 天内签署转让协议并上传工商变更证明。", "Your round filled. Sign the transfer agreement and upload the registry change within 30 days."), "good", a.id);
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

/** attestRegistration: the round is delivered and the shares go live. */
export function deliver(a: Asset, t: number) {
  const o = a.offering;
  o.deliveredAt = t;
  a.stage = "trading";
  a.listedAt = t;
  a.totalShares = o.sold;
  a.price = o.price;
  a.history = [{ t: t - DAY, p: o.price }, { t, p: o.price }];
  a.intraday = [{ t, p: o.price }];
  a.holders = Math.max(a.holders, o.investors);
  refreshBook(a);
  ensureMarket(a);
  feed("delivered", { name: a.owner.name, country: a.country }, a.id);
  if (S.me.escrow.some((e) => e.assetId === a.id && e.state === "active")) {
    notice(L_(`${a.name} 股权登记已核验，请确认收货领取份额（7 天后自动确认）。`, `${a.name}'s registry change is verified. Confirm receipt to get your shares (auto-confirms in 7 days).`), "good", a.id);
  }
  if (a.mine) {
    const others = o.raised - myEscrowPaid(a.id);
    const release = others * 0.6;
    payMerchant(a, release);
    notice(L_(`平台已核验工商变更。已有投资人确认收货，$${Math.round(release * 0.97).toLocaleString()} 已到账。`, `Registry change verified. Investors are confirming receipt; $${Math.round(release * 0.97).toLocaleString()} has arrived.`), "good", a.id);
  }
}

export function myEscrowPaid(assetId: string): number {
  return S.me.escrow.filter((e) => e.assetId === assetId && e.state !== "refunded").reduce((s, e) => s + e.paid, 0);
}

/** Investor payment released from escrow to the merchant, minus the platform fee. */
export function payMerchant(a: Asset, gross: number) {
  const net = gross * (1 - a.offering.feeBps / 10_000);
  a.offering.merchantReceived += net;
  if (a.mine) S.me.usdt += net;
}

export function confirmOrder(orderId: string, auto: boolean) {
  const e = S.me.escrow.find((x) => x.id === orderId);
  if (!e || e.state !== "active") return;
  const a = S.assets.find((x) => x.id === e.assetId)!;
  e.state = "confirmed";
  e.closedAt = now();
  e.auto = auto;
  const p = (S.me.positions[a.id] ??= emptyPosition());
  moveShares(p, e.shares, a.dps);
  p.cost += e.paid;
  payMerchant(a, e.paid);
  checkGlobal();
}

// ------------------------------------------------------------------ commitments (CommitmentVault)

export function distribute(a: Asset, amount: number) {
  if (a.totalShares <= 0 || amount <= 0) return;
  a.dps += amount / a.totalShares;
  a.distributed += amount;
}

export function recordPayment(a: Asset, i: number, t: number) {
  const c = a.commitment;
  const onTime = t <= dueDate(c, i) + c.graceDays * DAY;
  c.status[i] = onTime ? "paid" : "late";
  c.paid[i] = c.perPeriod;
  distribute(a, c.perPeriod);
  pushPrice(a, a.price * (onTime ? 1.025 : 0.99), t);
  feed("dividend", { name: a.owner.name, country: a.country }, a.id, c.perPeriod);
  if (holdsAsset(a)) {
    const mine = S.me.positions[a.id].shares * (c.perPeriod / a.totalShares);
    notice(L_(`${a.name} 第 ${i + 1} 期分红已到账：$${mine.toFixed(2)}，可在持仓页领取。`, `${a.name} period ${i + 1} dividend arrived: $${mine.toFixed(2)}. Claim it in Portfolio.`), "good", a.id);
  }
}

export function slashPeriod(a: Asset, i: number, t: number) {
  const c = a.commitment;
  const amount = Math.min(c.bond, c.perPeriod);
  c.bond -= amount;
  c.status[i] = "defaulted";
  c.paid[i] = amount;
  distribute(a, amount);
  pushPrice(a, a.price * 0.82, t);
  feed("default", { name: a.owner.name, country: a.country }, a.id, amount);
  if (a.audit) {
    a.audit.trustScore = Math.max(0, a.audit.trustScore - 12);
    a.audit.grade = a.audit.trustScore >= 85 ? "A" : a.audit.trustScore >= 75 ? "B" : a.audit.trustScore >= 60 ? "C" : a.audit.trustScore >= 45 ? "D" : "F";
    a.audit.flags.unshift({
      severity: "high",
      title: L_(`第 ${i + 1} 期分红违约`, `Defaulted on period ${i + 1}`),
      detail: L_(`宽限期结束未付款，保证金 $${amount.toLocaleString()} 已罚没并分给持有人。`, `Unpaid after the grace period; $${amount.toLocaleString()} of bond was slashed to holders.`),
    });
  }
  if (holdsAsset(a) || a.mine) {
    notice(
      L_(`${a.name} 第 ${i + 1} 期违约，保证金 $${amount.toLocaleString()} 已自动赔付给持有人。`, `${a.name} defaulted on period ${i + 1}; $${amount.toLocaleString()} of bond was paid to holders automatically.`),
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
