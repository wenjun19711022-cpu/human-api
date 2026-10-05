/** Read-only views the UI needs, computed from state with the same math as the contracts. */
import type { Asset, EscrowOrder } from "./types";
import { allocation, coverage, previewClearing } from "./market";

export function orderView(a: Asset, e: EscrowOrder) {
  const o = a.offering;
  const closed = !!o.clearing;
  const { cost, shares } = allocation(o, e);
  const live = e.state === "active" || e.state === "disputed";
  return {
    cost, // USDT that buys shares at the clearing price (an estimate until the round closes)
    shares,
    closed,
    unfilled: closed && a.stage !== "failed" && live ? Math.max(0, e.budget - cost - e.withdrawn) : 0,
    held: live ? e.budget - e.withdrawn : 0, // still inside the escrow contract
    limit: o.prices[e.tick],
  };
}

/** Live round numbers for cards and tickets. */
export function roundView(a: Asset) {
  const o = a.offering;
  const c = previewClearing(o);
  return {
    clearing: c,
    coverage: coverage(o),
    target: o.sharesForSale * o.prices[0],
    auction: o.prices.length > 1,
    oversubscribed: !c.atFloor,
  };
}
