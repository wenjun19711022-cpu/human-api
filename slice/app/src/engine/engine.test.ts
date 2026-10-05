import { test } from "node:test";
import assert from "node:assert/strict";
import { claimable, clear, emptyPosition, ladder, moveShares, myPayout, potentialPayout, requiredBondPeriods, sweep } from "./market";

// The same scenarios and numbers as slice/contracts/test, so the demo and the chain agree.

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("dividends follow transfers (ShareToken)", () => {
  let dps = 0;
  const alice = emptyPosition();
  const bob = emptyPosition();
  const carol = emptyPosition();
  moveShares(alice, 200_000, dps);
  moveShares(bob, 100_000, dps);
  dps += 9_000 / 300_000;
  near(claimable(alice, dps), 6_000);
  moveShares(alice, -100_000, dps);
  moveShares(carol, 100_000, dps);
  near(claimable(alice, dps), 6_000);
  assert.equal(claimable(carol, dps), 0);
  dps += 9_000 / 300_000;
  near(claimable(alice, dps), 9_000);
  near(claimable(carol, dps), 3_000);
});

const ladder5 = ladder(1, 1_000, 5); // 1.00, 1.10, 1.21, 1.331, 1.4641

test("auction: everyone above the clearing tick pays the same price (Auction.t.sol)", () => {
  near(ladder5[4], 1.4641);
  const c = clear(ladder5, [0, 40_000, 50_000, 0, 50_000], 100_000);
  assert.equal(c.tick, 1);
  near(c.price, 1.1);
  near(c.marginal, 10_000, 1e-3);
  near(c.raised, 110_000, 1e-3);
});

test("auction: price rises between ticks when top bidders cover supply", () => {
  const c = clear(ladder5, [0, 0, 0, 10_000, 140_000], 100_000);
  near(c.price, 1.4);
  assert.equal(c.marginal, 0);
  near(c.raised, 140_000);
});

test("auction: undersubscribed fills everyone at the floor", () => {
  const c = clear(ladder5, [20_000, 0, 0, 0, 40_000], 100_000);
  assert.ok(c.atFloor);
  near(c.price, 1);
  near(c.raised, 60_000);
});

test("fixed price oversubscription is pro rata (EscrowOffering.t.sol)", () => {
  const c = clear([1], [450_000], 300_000);
  near(c.marginal, 300_000);
  near(c.marginal / 450_000, 2 / 3);
});

test("bond is priced from the trust score and default record (SliceHub)", () => {
  assert.equal(requiredBondPeriods(86, 0), 1);
  assert.equal(requiredBondPeriods(78, 0), 2);
  assert.equal(requiredBondPeriods(65, 0), 3);
  assert.equal(requiredBondPeriods(50, 0), 4);
  assert.equal(requiredBondPeriods(90, 1), 2);
});

test("market buy sweeps the cheapest asks first (ShareExchange)", () => {
  const r = sweep(
    [
      { price: 1.2, size: 10_000 },
      { price: 1.3, size: 10_000 },
    ],
    { budget: 20_000, side: "buy" },
  );
  assert.equal(r.fills[0].price, 1.2);
  assert.ok(Math.abs(r.size - 16_077) < 1, `got ${r.size}`);
  assert.ok(r.cost + r.fee <= 20_000 + 1e-6);
});

test("parimutuel payout (ConfidenceMarket)", () => {
  const m = { period: 0, yes: 1_000, no: 500, myYes: 1_000, myNo: 0, resolved: "yes" as const, claimed: false };
  near(myPayout(m), 1_490);
  assert.equal(myPayout({ ...m, resolved: "no" as const }), 0);
  const empty = { period: 0, yes: 0, no: 700, myYes: 0, myNo: 700, resolved: "yes" as const, claimed: false };
  assert.equal(myPayout(empty), 700, "no winners: everyone refunded");
  assert.ok(potentialPayout({ ...m, myYes: 0, resolved: null }, "no", 500) > 500);
});

test("vault: installments, shortfall-only slashing and fee vesting (Commitment.t.sol)", async () => {
  const store = await import("./store");
  const { contribute, slashPeriod } = await import("./ops");
  store.resetWorld();
  const S = store.S;
  const a = S.assets.find((x) => x.id === "kaze")!;
  const c = a.commitment;
  const i = c.status.indexOf("pending");
  c.credit[i] = 0;
  const fee0 = c.feeRemaining;
  const feeH0 = c.feeToHolders;
  const distributed0 = a.distributed;
  contribute(a, c.perPeriod * 0.4, c.firstDue);
  assert.equal(c.status[i], "pending");
  near(c.credit[i], c.perPeriod * 0.4);
  const bond0 = c.bond;
  slashPeriod(a, i, c.firstDue + 30 * 86_400_000);
  near(bond0 - c.bond, c.perPeriod * 0.6, 1e-6);
  assert.equal(c.status[i], "defaulted");
  const slice = fee0 / (c.numPeriods - (c.settled - 1));
  near(c.feeToHolders - feeH0, slice, 1e-6); // the defaulted period's fee slice goes to holders
  near(a.distributed - distributed0, c.perPeriod + slice, 1e-6);
});

test("leaderboards rank honest behavior, not activity (board.ts)", async () => {
  const { questionPoints, hunterBoard, settleRivalBets, oracleBoard, landlordBoard, MIN_ORACLE_CALLS } = await import("./board");
  // Asking alone earns nothing; your own upvote doesn't count; forcing a document or exposing a dodge does.
  assert.equal(questionPoints({ votes: 1, voted: true, mine: true, evasive: 0 }), 0);
  assert.equal(questionPoints({ votes: 12, evasive: 0 }), 12);
  assert.equal(questionPoints({ votes: 5, evasive: 0, answer: { doc: "POS export" } }), 25);
  assert.equal(questionPoints({ votes: 0, evasive: 3, answer: {} }), 30);

  const store = await import("./store");
  store.resetWorld();
  const S = store.S; // live binding: read it after the reset
  const me = { name: "You", country: "CN" };
  const hunters = hunterBoard(S.assets, me);
  assert.ok(hunters.every((r, i) => i === 0 || hunters[i - 1].score >= r.score), "sorted");
  assert.ok(!hunters.some((r) => r.who.country === "AI"), "the AI agent never ranks");

  // A rival's stake settles exactly like ConfidenceMarket.payoutOf.
  const rival = S.rivals[0];
  const before = { ...rival.oracle };
  const m = { period: 0, yes: 1_000, no: 500, myYes: 0, myNo: 0, resolved: "yes" as const, claimed: false };
  rival.bets.push({ assetId: "x", period: 0, side: "yes", amount: 100 });
  settleRivalBets(S.rivals, "x", m);
  near(rival.oracle.pnl - before.pnl, (100 * 500 * 0.98) / 1_000);
  assert.equal(rival.oracle.n, before.n + 1);
  assert.equal(rival.bets.length, 0);
  assert.ok(oracleBoard(S.rivals, S.assets, me).every((r) => r.me || r.detail.b >= MIN_ORACLE_CALLS), "luck doesn't rank");

  // Landlords rank by dividends received: buying a big position today earns no rank until it pays.
  const a = S.assets.find((x) => x.stage === "trading" && x.dps > 0)!;
  const whale = S.rivals[1];
  const lb0 = landlordBoard(S.rivals, S.assets, S.me, me).find((r) => r.who.name === whale.name)?.score ?? 0;
  const pos = (whale.positions[a.id] ??= emptyPosition());
  moveShares(pos, a.totalShares * 0.5, a.dps);
  const lb1 = landlordBoard(S.rivals, S.assets, S.me, me).find((r) => r.who.name === whale.name)?.score ?? 0;
  near(lb1, lb0);
});

test("the simulated world runs 400 days without breaking invariants", async () => {
  const { resetWorld } = await import("./store");
  const { advance } = await import("./sim");
  resetWorld();
  advance(400);
  const { S } = await import("./store");
  assert.ok(Number.isFinite(S.me.usdt) && S.me.usdt >= 0);
  for (const r of S.rivals) {
    assert.ok(Number.isFinite(r.oracle.pnl) && r.oracle.hits <= r.oracle.n, `${r.name} oracle record`);
    for (const p of Object.values(r.positions)) assert.ok(p.shares >= -1e-6, `${r.name} short`);
  }
  for (const a of S.assets) {
    assert.ok(Number.isFinite(a.price) && a.price > 0, `${a.symbol} price`);
    assert.ok(a.commitment.bond >= -1e-9, `${a.symbol} bond`);
    assert.ok(a.commitment.feeRemaining >= -1e-9, `${a.symbol} fee`);
    if (a.offering.clearing) assert.ok(a.offering.clearing.raised / a.offering.clearing.price <= a.offering.sharesForSale + 1e-6, `${a.symbol} oversold`);
    for (let i = 0; i < a.commitment.numPeriods; i++) assert.ok(a.commitment.credit[i] <= a.commitment.perPeriod + 1e-6, `${a.symbol} over-credited`);
  }
  for (const e of S.me.escrow) {
    const a = S.assets.find((x) => x.id === e.assetId)!;
    assert.ok(e.state !== "active" || a.stage === "failed", `${a.symbol} order left ${e.state} in ${a.stage}`);
    assert.ok(e.withdrawn <= e.budget + 1e-9);
  }
});
