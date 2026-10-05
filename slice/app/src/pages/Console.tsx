import React from "react";
import { S, now, useWorld } from "../engine/store";
import { attest, resolveDispute, run } from "../engine/actions";
import { Empty, Tile } from "../components/ui";
import { IShield, IScale, ISpark, IFile } from "../components/icons";
import { l, tr } from "../lib/i18n";
import { ago, countdown, shortHash, usd, TIME } from "../lib/format";
import { orderView } from "../engine/view";
import { go } from "../lib/nav";

export function Console() {
  useWorld();
  const t = now();
  const pending = S.assets.filter((a) => a.stage === "settling" && a.offering.registrationProof && !a.offering.deliveredAt);
  const disputes = S.me.escrow.filter((e) => e.state === "disputed");
  const alerts = S.assets.filter((a) => a.audit?.flags.some((f) => f.severity === "high"));

  return (
    <>
      <div className="stack tight">
        <span className="eyebrow">{tr("平台角色", "Platform role")}</span>
        <h1>{tr("平台审核台", "Verifier desk")}</h1>
        <p className="soft" style={{ maxWidth: 680 }}>
          {tr(
            "平台只做两件事：核验登记变更（EscrowOffering.attestRegistration）和处理仲裁（resolveDispute）。平台碰不到托管资金，也不能替商户确认收货。",
            "The platform does two things: verify registry changes (EscrowOffering.attestRegistration) and resolve disputes (resolveDispute). It can't touch escrowed money or confirm receipt for anyone.",
          )}
        </p>
      </div>

      <div className="card flush">
        <div className="li">
          <IShield size={18} />
          <h3 className="grow">{tr("待核验的工商变更", "Registry changes to verify")}</h3>
          <span className="pill">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <Empty icon={<IFile />} title={tr("没有待核验的证明", "Nothing waiting")} />
        ) : (
          <div className="list">
            {pending.map((a) => (
              <div key={a.id} className="li">
                <Tile a={a} />
                <div className="grow stack tight" style={{ gap: 1 }}>
                  <b>{a.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {tr("协议", "Agreement")} <span className="mono">{shortHash(a.offering.agreementHash)}</span> · {tr("登记证明", "Proof")}{" "}
                    <span className="mono">{shortHash(a.offering.registrationProof)}</span> · {ago(a.offering.proofUploadedAt ?? t, t)}
                  </span>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {tr(`交割截止 ${countdown(a.offering.settleDeadline ?? t, t)}后`, `Deadline in ${countdown(a.offering.settleDeadline ?? t, t)}`)}
                  </span>
                </div>
                <button className="btn sm primary" onClick={() => run(() => attest(a.id))}>
                  {tr("核验通过", "Verify")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card flush">
        <div className="li">
          <IScale size={18} />
          <h3 className="grow">{tr("仲裁", "Disputes")}</h3>
          <span className="pill">{disputes.length}</span>
        </div>
        {disputes.length === 0 ? (
          <Empty icon={<IScale />} title={tr("没有进行中的仲裁", "No open disputes")}>
            <span style={{ fontSize: 13 }}>{tr("在「订单」里对待收货的订单申请仲裁，就会出现在这里。", "File a dispute on an order awaiting confirmation and it shows up here.")}</span>
          </Empty>
        ) : (
          <div className="list">
            {disputes.map((e) => {
              const a = S.assets.find((x) => x.id === e.assetId)!;
              return (
                <div key={e.id} className="li" style={{ flexWrap: "wrap" }}>
                  <Tile a={a} />
                  <div className="grow stack tight" style={{ gap: 1 }}>
                    <b>
                      {a.name} · {usd(orderView(a, e).cost, 2)}
                    </b>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {tr("理由：", "Reason: ")}
                      {e.disputeReason} · {tr("押金", "bond")} {usd(e.disputeBond ?? 0, 2)}
                    </span>
                    <span className={t > (e.disputedAt ?? t) + 14 * TIME.DAY ? "down" : "muted"} style={{ fontSize: 12.5 }}>
                      {tr(
                        `请在 ${countdown((e.disputedAt ?? t) + 14 * TIME.DAY, t)}内裁决，否则投资人可自行全额退款（平台失职由平台承担）`,
                        `Rule within ${countdown((e.disputedAt ?? t) + 14 * TIME.DAY, t)}, or the investor can refund themselves`,
                      )}
                    </span>
                  </div>
                  <div className="row">
                    <button className="btn sm down" onClick={() => run(() => resolveDispute(e.id, true))}>
                      {tr("退款给投资人", "Refund investor")}
                    </button>
                    <button className="btn sm ghost" onClick={() => run(() => resolveDispute(e.id, false))}>
                      {tr("交割有效，押金归商户", "Delivery stands; bond to merchant")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card flush">
        <div className="li">
          <ISpark size={18} />
          <h3 className="grow">{tr("AI 哨兵预警", "AI sentinel alerts")}</h3>
        </div>
        {alerts.length === 0 ? (
          <Empty icon={<ISpark />} title={tr("一切正常", "All clear")} />
        ) : (
          <div className="list">
            {alerts.map((a) => (
              <button key={a.id} className="li clickable" onClick={() => go(`asset-${a.id}`)}>
                <Tile a={a} />
                <div className="grow stack tight" style={{ gap: 1 }}>
                  <b>{a.name}</b>
                  {a.audit!.flags
                    .filter((f) => f.severity === "high")
                    .slice(0, 2)
                    .map((f, i) => (
                      <span key={i} className="down" style={{ fontSize: 13 }}>
                        {l(f.title)} · <span className="soft">{l(f.detail)}</span>
                      </span>
                    ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
