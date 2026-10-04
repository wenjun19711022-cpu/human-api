import { test } from "node:test";
import assert from "node:assert/strict";
import { claimable, emptyPosition, moveShares, myPayout, potentialPayout, sweep } from "./market";

// The same scenarios as slice/contracts/test, so the demo and the chain agree on the numbers.

test("dividends follow transfers (ShareToken)", () => {
  let dps = 0;
  const alice = emptyPosition();
  const bob = emptyPosition();
  const carol = emptyPosition();
  moveShares(alice, 200_000, dps);
  moveShares(bob, 100_000, dps);
  dps += 9_000 / 300_000;
  assert.ok(Math.abs(claimable(alice, dps) - 6_000) < 1e-6);
  moveShares(alice, -100_000, dps);
  moveShares(carol, 100_000, dps);
  assert.ok(Math.abs(claimable(alice, dps) - 6_000) < 1e-6, "earned dividend stays with seller");
  assert.equal(claimable(carol, dps), 0);
  dps += 9_000 / 300_000;
  assert.ok(Math.abs(claimable(alice, dps) - 9_000) < 1e-6);
  assert.ok(Math.abs(claimable(carol, dps) - 3_000) < 1e-6);
});

test("market buy sweeps the cheapest asks first (ShareExchange)", () => {
  const asks = [
    { price: 1.2, size: 10_000 },
    { price: 1.3, size: 10_000 },
  ];
  const r = sweep(asks, { budget: 20_000, side: "buy" });
  assert.equal(r.fills[0].price, 1.2);
  assert.ok(Math.abs(r.size - 16_077) < 1, `got ${r.size}`);
  assert.ok(r.cost + r.fee <= 20_000 + 1e-6);
});

test("sell respects a limit price", () => {
  const bids = [
    { price: 1.0, size: 100 },
    { price: 0.9, size: 100 },
  ];
  const r = sweep(bids, { maxShares: 150, limit: 0.95, side: "sell" });
  assert.equal(r.size, 100);
});

test("parimutuel payout (ConfidenceMarket)", () => {
  const m = { period: 0, yes: 1_000, no: 500, myYes: 1_000, myNo: 0, resolved: "yes" as const, claimed: false };
  assert.ok(Math.abs(myPayout(m) - 1_490) < 1e-9);
  const lost = { ...m, resolved: "no" as const };
  assert.equal(myPayout(lost), 0);
  const empty = { period: 0, yes: 0, no: 700, myYes: 0, myNo: 700, resolved: "yes" as const, claimed: false };
  assert.equal(myPayout(empty), 700, "no winners: everyone refunded");
  assert.ok(potentialPayout({ ...m, myYes: 0, resolved: null }, "no", 500) > 500);
});

test("the simulated world runs 400 days without breaking invariants", async () => {
  const { S, resetWorld } = await import("./store");
  const { advance } = await import("./sim");
  resetWorld();
  advance(400);
  const { S: after } = await import("./store");
  assert.ok(Number.isFinite(after.me.usdt) && after.me.usdt >= 0);
  for (const a of after.assets) {
    assert.ok(Number.isFinite(a.price) && a.price > 0, `${a.symbol} price`);
    assert.ok(a.offering.sold <= a.offering.sharesForSale + 1e-6, `${a.symbol} oversold`);
    assert.ok(a.commitment.bond >= 0, `${a.symbol} bond`);
  }
  // Every escrow order ends confirmed, refunded or still refundable after a failure.
  for (const e of after.me.escrow) {
    const a = after.assets.find((x) => x.id === e.assetId)!;
    assert.ok(e.state !== "active" || a.stage === "failed", `${a.symbol} order left ${e.state} in ${a.stage}`);
  }
  void S;
});
