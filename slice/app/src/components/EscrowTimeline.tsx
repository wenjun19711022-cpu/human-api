import React from "react";
import type { Asset, EscrowOrder } from "../engine/types";
import { now } from "../engine/store";
import { ICheck, IClock, IX } from "./icons";
import { tr } from "../lib/i18n";
import { countdown, dateTime, shortHash, usd, shares as fmtShares, TIME } from "../lib/format";

type Node = { title: string; detail: string; state: "done" | "now" | "todo" | "bad" };

/** The 确认收货 flow of EscrowOffering, as a receipt-style timeline. */
export function escrowSteps(a: Asset, e: EscrowOrder): Node[] {
  const o = a.offering;
  const t = now();
  const filled = a.stage === "settling" || a.stage === "trading" || (o.settleDeadline !== null && a.stage !== "failed");
  const failed = a.stage === "failed";
  const delivered = !!o.deliveredAt;
  const confirmed = e.state === "confirmed";
  const nodes: Node[] = [
    { title: tr("USDT 已锁入托管合约", "USDT locked in escrow"), detail: `${usd(e.paid)} · ${dateTime(e.at)}`, state: "done" },
    {
      title: tr("认购成团", "Round fills"),
      detail: failed && !o.settleDeadline
        ? tr("未达到最低募资额，可全额退款", "Minimum not reached; fully refundable")
        : filled
          ? tr(`已成团 · 共 ${usd(o.raised)}`, `Filled · ${usd(o.raised)} raised`)
          : tr(`${countdown(o.deadline, t)}后截止 · 已认购 ${Math.round((o.raised / (o.sharesForSale * o.price)) * 100)}%`, `Closes in ${countdown(o.deadline, t)} · ${Math.round((o.raised / (o.sharesForSale * o.price)) * 100)}% subscribed`),
      state: failed && !o.settleDeadline ? "bad" : filled ? "done" : "now",
    },
    {
      title: tr("商户签署股份转让协议", "Merchant signs the transfer agreement"),
      detail: o.agreementHash ? `${tr("协议哈希", "Agreement hash")} ${shortHash(o.agreementHash)}` : filled ? tr("等待签署", "Waiting for signature") : "—",
      state: o.agreementHash ? "done" : filled && !failed ? "now" : failed && o.settleDeadline ? "bad" : "todo",
    },
    {
      title: tr("工商变更由平台核验", "Registry change verified"),
      detail: delivered
        ? `${tr("登记凭证", "Proof")} ${shortHash(o.registrationProof)} · ${dateTime(o.deliveredAt!)}`
        : o.registrationProof
          ? tr("商户已上传，平台核验中", "Uploaded; platform verifying")
          : o.settleDeadline && !failed
            ? tr(`交割截止 ${countdown(o.settleDeadline, t)}后`, `Settlement deadline in ${countdown(o.settleDeadline, t)}`)
            : failed && o.settleDeadline
              ? tr("商户未按期交割，可全额退款", "Merchant missed the deadline; fully refundable")
              : "—",
      state: delivered ? "done" : o.agreementHash && !failed ? "now" : failed && o.settleDeadline ? "bad" : "todo",
    },
    {
      title: tr("你确认收货", "You confirm receipt"),
      detail: confirmed
        ? `${e.auto ? tr("超时自动确认", "Auto-confirmed") : tr("已确认", "Confirmed")} · ${dateTime(e.closedAt ?? t)}`
        : e.state === "disputed"
          ? tr(`仲裁中：${e.disputeReason ?? ""}`, `In arbitration: ${e.disputeReason ?? ""}`)
          : e.state === "refunded"
            ? tr("已全额退款", "Refunded in full")
            : delivered
              ? tr(`${countdown(o.deliveredAt! + o.confirmDays * TIME.DAY, t)}后自动确认`, `Auto-confirms in ${countdown(o.deliveredAt! + o.confirmDays * TIME.DAY, t)}`)
              : "—",
      state: confirmed ? "done" : e.state === "disputed" || e.state === "refunded" ? "bad" : delivered ? "now" : "todo",
    },
    {
      title: tr("份额到账 · 款项放给商户", "Shares delivered · merchant paid"),
      detail: confirmed ? tr(`${fmtShares(e.shares)} 份已到你的钱包`, `${fmtShares(e.shares)} shares in your wallet`) : tr(`将获得 ${fmtShares(e.shares)} 份`, `You'll get ${fmtShares(e.shares)} shares`),
      state: confirmed ? "done" : "todo",
    },
  ];
  return nodes;
}

export function EscrowTimeline({ a, e, compact }: { a: Asset; e: EscrowOrder; compact?: boolean }) {
  const nodes = escrowSteps(a, e);
  const shown = compact ? nodes.filter((n, i) => n.state !== "todo" || nodes[i - 1]?.state === "now" || i === nodes.length - 1) : nodes;
  return (
    <div className="timeline">
      {shown.map((n) => (
        <div key={n.title} className={`tl ${n.state}`}>
          <span className="node">{n.state === "done" ? <ICheck /> : n.state === "bad" ? <IX /> : n.state === "now" ? <IClock /> : null}</span>
          <div className="stack tight" style={{ gap: 1 }}>
            <span className="t">{n.title}</span>
            <span className="d">{n.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
