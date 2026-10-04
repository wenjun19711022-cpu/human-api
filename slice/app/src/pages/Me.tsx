import React from "react";
import { S, commit, now, resetWorld, useWorld } from "../engine/store";
import { faucet, fastForward, markNoticesRead, run } from "../engine/actions";
import { BADGES, LEVELS, LEVEL_NAMES, levelOf } from "../engine/ops";
import { Meter, Seg } from "../components/ui";
import { IBell, IFast, IGift, IShield, IStore, ITrophy, ICoin, IGlobe, ILock, ISpark, IChat, IReceipt, IPulse } from "../components/icons";
import { setLang, l, tr } from "../lib/i18n";
import { ago, date, usd } from "../lib/format";
import { go } from "../lib/nav";
import { flag } from "../engine/geo";

const BADGE_ICON: Record<string, React.ReactNode> = {
  first: <ICoin />,
  early: <ISpark />,
  global: <IGlobe />,
  hunter: <IChat />,
  landlord: <ICoin />,
  oracle: <IPulse />,
  merchant: <IStore />,
  receipt: <IReceipt />,
};

export const REPO = "https://github.com/wenjun19711022-cpu/human-api/tree/claude/beautiful-sagan-fko3ug/slice";

export function Me() {
  useWorld();
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const lv = levelOf(S.me.xp);
  const nextAt = LEVELS[lv + 1] ?? LEVELS[lv];
  const prevAt = LEVELS[lv];
  const progress = nextAt === prevAt ? 1 : (S.me.xp - prevAt) / (nextAt - prevAt);
  const address = "0x5L1C" + "e".repeat(4) + "7a1d9c03b2f84e6d0c91a5b7e2f4d68c";
  const unread = S.notices.filter((n) => !n.read).length;

  return (
    <>
      <div className="two">
        <div className="card stack">
          <div className="row" style={{ gap: 14 }}>
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 30 }}>
              {flag(S.me.country)}
            </span>
            <div className="grow stack tight" style={{ gap: 2 }}>
              <h2>
                Lv.{lv + 1} · {l(LEVEL_NAMES[lv])}
              </h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {S.me.xp} XP · {tr(`距离下一级还差 ${Math.max(0, nextAt - S.me.xp)} XP`, `${Math.max(0, nextAt - S.me.xp)} XP to next level`)}
              </span>
            </div>
          </div>
          <Meter value={progress} />
          <p className="muted" style={{ fontSize: 12.5 }}>
            {tr("认购、交易、提问、领分红、确认收货都会获得经验。", "Subscribing, trading, asking, claiming and confirming receipt all earn XP.")}
          </p>
        </div>

        <div className="card stack">
          <div className="spread">
            <span className="eyebrow">{tr("测试网钱包", "Testnet wallet")}</span>
            <span className="pill">USDT · {tr("模拟", "simulated")}</span>
          </div>
          <span className="big-price" style={{ fontSize: 34 }}>
            {usd(S.me.usdt, 2)}
          </span>
          <div className="row wrap">
            <button className="btn primary" onClick={() => run(faucet)}>
              <IGift /> {tr("领取 1,000 测试 USDT", "Get 1,000 test USDT")}
            </button>
          </div>
          <div className="stack tight">
            <span className="muted" style={{ fontSize: 12.5 }}>
              {tr("充值地址（演示，请勿转入真实资产）", "Deposit address (demo only; never send real funds)")}
            </span>
            <div className="row">
              <code className="mono grow" style={{ overflowWrap: "anywhere", userSelect: "all" }}>
                {address}
              </code>
              <button
                className="btn xs ghost"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(address)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? tr("已复制", "Copied") : tr("复制", "Copy")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="spread wrap">
          <div className="stack tight">
            <h3>{tr("时间机器", "Time machine")}</h3>
            <p className="soft" style={{ fontSize: 13.5 }}>
              {tr(
                `认购截止、交割、自动确认收货、季度分红、违约罚没都按真实时间发生。快进时间，几秒钟走完一门生意的完整周期。模拟日期：${date(now())}`,
                `Deadlines, settlement, auto-confirm, quarterly payouts and slashing all run on real time. Skip ahead to see a full cycle in seconds. Simulated date: ${date(now())}`,
              )}
            </p>
          </div>
          <div className="row wrap">
            {[1, 7, 30, 91].map((d) => (
              <button key={d} className="btn ghost sm" onClick={() => run(() => fastForward(d))}>
                <IFast /> {d === 91 ? tr("+1 季度", "+1 quarter") : tr(`+${d} 天`, `+${d}d`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="two">
        <div className="card flush">
          <div className="li">
            <IBell size={18} />
            <h3 className="grow">{tr("通知", "Notifications")}</h3>
            {unread > 0 && (
              <button className="btn xs ghost" onClick={() => run(markNoticesRead)}>
                {tr("全部已读", "Mark all read")}
              </button>
            )}
          </div>
          <div className="list" style={{ maxHeight: 380, overflow: "auto" }}>
            {S.notices.length === 0 && <div className="empty">{tr("暂无通知", "Nothing yet")}</div>}
            {S.notices.map((n) => (
              <button
                key={n.id}
                className="li clickable"
                onClick={() => {
                  n.read = true;
                  commit();
                  if (n.assetId) go(`asset-${n.assetId}`);
                }}
              >
                <span className={`status-dot ${n.tone === "good" ? "pass" : n.tone === "bad" ? "fail" : n.tone === "warn" ? "warn" : "info"}`} style={{ width: 10, height: 10, borderRadius: 5, flex: "none" }} />
                <span className="grow" style={{ fontSize: 13.5, fontWeight: n.read ? 400 : 650 }}>
                  {l(n.text)}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {ago(n.at, now())}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card stack">
          <div className="spread">
            <h3>{tr("徽章", "Badges")}</h3>
            <span className="muted num">
              {S.me.badges.length}/{Object.keys(BADGES).length}
            </span>
          </div>
          <div className="badges">
            {Object.entries(BADGES).map(([id, b]) => (
              <div key={id} className={`badge ${S.me.badges.includes(id) ? "got" : ""}`} title={l(b.desc)}>
                <span className="ic">{BADGE_ICON[id] ?? <ITrophy />}</span>
                <span className="stack tight" style={{ gap: 0 }}>
                  <b style={{ fontSize: 13 }}>{l(b.name)}</b>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {l(b.desc)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="three">
        <button className="card stack" style={{ textAlign: "left" }} onClick={() => go("merchant")}>
          <IStore size={24} />
          <h3>{tr("商户中心", "Merchant center")}</h3>
          <p className="soft" style={{ fontSize: 13.5 }}>{tr("把你的生意推上链：提交材料、AI 尽调、公开问答、开启认购、交割、分红。", "Take your business on-chain: documents, AI review, public Q&A, round, settlement, dividends.")}</p>
        </button>
        <button className="card stack" style={{ textAlign: "left" }} onClick={() => go("console")}>
          <IShield size={24} />
          <h3>{tr("平台审核台", "Verifier desk")}</h3>
          <p className="soft" style={{ fontSize: 13.5 }}>{tr("扮演平台：核验工商变更、处理仲裁、查看 AI 哨兵预警。", "Play the platform: verify registry changes, arbitrate disputes, review AI sentinel alerts.")}</p>
        </button>
        <div className="card stack">
          <ILock size={24} />
          <h3>{tr("设置", "Settings")}</h3>
          <Seg
            value={S.lang}
            onChange={(v) => {
              S.lang = v;
              setLang(v);
              commit();
            }}
            items={[
              { id: "zh", label: "中文" },
              { id: "en", label: "English" },
            ]}
          />
          <Seg
            value={S.theme}
            onChange={(v) => {
              S.theme = v;
              commit();
            }}
            items={[
              { id: "system", label: tr("跟随系统", "System") },
              { id: "light", label: tr("浅色", "Light") },
              { id: "dark", label: tr("深色", "Dark") },
            ]}
          />
        </div>
      </div>

      <div className="card stack">
        <h3>{tr("这个演示和真实链上合约的关系", "How this demo maps to the contracts")}</h3>
        <p className="soft" style={{ fontSize: 14 }}>
          {tr(
            "页面里的每一个动作，都对应仓库中已测试的 Solidity 合约：SliceHub（上链申请与 AI 审核上链）、EscrowOffering（托管认购、确认收货、自动确认、仲裁、退款）、ShareToken（按持股实时分红）、CommitmentVault（分红承诺与保证金罚没）、ConfidenceMarket（无预言机的信心市场）、ShareExchange（链上订单簿）。演示里的资金是模拟的测试网 USDT。",
            "Every action here maps to a tested Solidity contract in the repo: SliceHub (applications and on-chain AI audits), EscrowOffering (escrowed rounds, confirm receipt, auto-confirm, disputes, refunds), ShareToken (pro-rata dividends), CommitmentVault (bonded dividend promises and slashing), ConfidenceMarket (oracle-free confidence markets) and ShareExchange (on-chain order book). Funds in the demo are simulated testnet USDT.",
          )}
        </p>
        <div className="row wrap">
          <a className="btn ghost sm" href={REPO} target="_blank" rel="noreferrer">
            {tr("查看源码", "View source")}
          </a>
          {confirmReset ? (
            <>
              <span className="muted" style={{ fontSize: 13 }}>
                {tr("确定重置？你的演示进度会清空。", "Reset? Your demo progress will be cleared.")}
              </span>
              <button
                className="btn sm down"
                onClick={() => {
                  resetWorld();
                  setConfirmReset(false);
                  go("market");
                }}
              >
                {tr("确认重置", "Reset")}
              </button>
              <button className="btn sm quiet" onClick={() => setConfirmReset(false)}>
                {tr("取消", "Cancel")}
              </button>
            </>
          ) : (
            <button className="btn sm quiet" onClick={() => setConfirmReset(true)}>
              {tr("重置演示", "Reset demo")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
