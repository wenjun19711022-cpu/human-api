import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Report } from "./report.js";

const HUB_ABI = parseAbi([
  "function recordAudit(uint256 id, uint16 score, bytes32 auditHash, bool approved)",
]);

/**
 * The agent's key is registered as a verifier on SliceHub (hub.setVerifier). Posting the score and the
 * report hash on-chain is what unlocks hub.launch() for the merchant. "review" verdicts are not approved:
 * a human verifier signs those after the public Q&A.
 */
export async function publishAudit(assetId: bigint, report: Report, hash: Hex): Promise<Hex> {
  const { RPC_URL, VERIFIER_PRIVATE_KEY, SLICE_HUB } = process.env;
  if (!RPC_URL || !VERIFIER_PRIVATE_KEY || !SLICE_HUB) {
    throw new Error("Set RPC_URL, VERIFIER_PRIVATE_KEY and SLICE_HUB to publish on-chain");
  }
  const wallet = createWalletClient({
    account: privateKeyToAccount(VERIFIER_PRIVATE_KEY as Hex),
    transport: http(RPC_URL),
  });
  return wallet.writeContract({
    chain: null,
    address: SLICE_HUB as Hex,
    abi: HUB_ABI,
    functionName: "recordAudit",
    args: [assetId, report.trustScore, hash, report.verdict === "pass"],
  });
}
