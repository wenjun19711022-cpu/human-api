import React from "react";
import { S, commit, now, useWorld } from "./engine/store";
import { botTick, catchUp } from "./engine/sim";
import { fastForward, run } from "./engine/actions";
import { levelOf } from "./engine/ops";
import { Market } from "./pages/Market";
import { AssetPage } from "./pages/AssetPage";
import { Portfolio } from "./pages/Portfolio";
import { Orders } from "./pages/Orders";
import { Confidence } from "./pages/Confidence";
import { Me } from "./pages/Me";
import { Merchant } from "./pages/Merchant";
import { Console } from "./pages/Console";
import { Effects } from "./components/Effects";
import { Sheet } from "./components/ui";
import { IBell, IFast, ILock, IMarket, IMoon, IPie, IPulse, IReceipt, IShield, IStore, ISun, IUser, ISpark, IGift } from "./components/icons";
import { setLang, tr } from "./lib/i18n";
import { date, usd } from "./lib/format";
import { go, routeFromHash } from "./lib/nav";
import { faucet } from "./engine/actions";

const NAV: { id: string; icon: React.ReactNode; zh: string; en: string }[] = [
  { id: "market", icon: <IMarket />, zh: "市场", en: "Market" },
  { id: "confidence", icon: <IPulse />, zh: "信心", en: "Confidence" },
  { id: "portfolio", icon: <IPie />, zh: "持仓", en: "Portfolio" },
  { id: "orders", icon: <IReceipt />, zh: "订单", en: "Orders" },
  { id: "me", icon: <IUser />, zh: "我的", en: "Me" },
];

function useTheme() {
  React.useEffect(() => {
    const root = document.documentElement;
    if (S.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", S.theme);
  });
}

function NavButtons() {
  const section = S.route.startsWith("asset-") ? "market" : S.route;
  const toConfirm = S.me.escrow.filter((e) => e.state === "active" && S.assets.find((a) => a.id === e.assetId)?.offering.deliveredAt).length;
  return (
    <>
      {NAV.map((n) => (
        <button key={n.id} className="navbtn" aria-current={section === n.id ? "page" : undefined} onClick={() => go(n.id)}>
          {n.icon}
          <span>{tr(n.zh, n.en)}</span>
          {n.id === "orders" && toConfirm > 0 && <span className="dot">{toConfirm}</span>}
        </button>
      ))}
    </>
  );
}

function Welcome() {
  const [open, setOpen] = React.useState(!S.me.welcomed);
  const close = () => {
    S.me.welcomed = true;
    setOpen(false);
    commit();
  };
  const points: [React.ReactNode, string, string, string, string][] = [
    [<IMarket />, "全世界的生意，一片一片买", "Buy any business, one slice at a time", "从 $1 起，用 USDT 买酒吧股权、歌曲版税、电站收入。", "From $1 in USDT: bar equity, song royalties, solar revenue."],
    [<ILock />, "像担保交易一样放心", "Protected like escrow", "钱先锁在合约里。商户完成工商登记、你确认收货才放款，否则全额退。", "Money waits in a contract until the merchant registers the transfer and you confirm receipt. Otherwise, a full refund."],
    [<IShield />, "承诺分红有保证金兜底", "Bonded dividend promises", "商户承诺的每一期分红都押了保证金，违约自动赔给你。", "Every promised payout is backed by a bond that pays you automatically on a default."],
    [<ISpark />, "AI 尽调 + 公开问答", "AI checks + public Q&A", "AI 核验工商、证件、地图、社媒和流水；任何人都能向老板提问。", "AI checks the registry, ID, maps, socials and bank records, and anyone can question the owner."],
  ];
  return (
    <Sheet open={open} onClose={close} label="Welcome">
      <div className="stack tight">
        <span className="eyebrow">{tr("测试网演示", "Testnet demo")}</span>
        <h2>{tr("欢迎来到 Slice", "Welcome to Slice")}</h2>
      </div>
      <div className="stack">
        {points.map(([icon, zh, en, dzh, den], i) => (
          <div key={i} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <span className="status-dot run" style={{ width: 36, height: 36, borderRadius: 11, flex: "none" }}>
              {icon}
            </span>
            <div className="stack tight" style={{ gap: 1 }}>
              <b>{tr(zh, en)}</b>
              <span className="soft" style={{ fontSize: 13.5 }}>
                {tr(dzh, den)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        {tr("演示钱包里已有 2,500 测试 USDT、两笔持仓和一笔待确认收货的订单。所有生意与人物均为虚构。", "The demo wallet starts with 2,500 test USDT, two holdings and one order waiting for you to confirm receipt. All businesses and people are fictional.")}
      </p>
      <button className="btn primary lg block" onClick={close}>
        {tr("开始逛逛", "Start exploring")}
      </button>
    </Sheet>
  );
}

function NoticesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label={tr("通知", "Notifications")}>
      <h2>{tr("通知", "Notifications")}</h2>
      <div className="stack tight">
        {S.notices.slice(0, 12).map((n) => (
          <button
            key={n.id}
            className="li clickable"
            style={{ padding: "10px 4px" }}
            onClick={() => {
              n.read = true;
              onClose();
              if (n.assetId) go(`asset-${n.assetId}`);
              else commit();
            }}
          >
            <span className={`status-dot ${n.tone === "good" ? "pass" : n.tone === "bad" ? "fail" : n.tone === "warn" ? "warn" : "info"}`} style={{ width: 10, height: 10, borderRadius: 5, flex: "none" }} />
            <span className="grow" style={{ fontSize: 13.5, fontWeight: n.read ? 400 : 650, textAlign: "left" }}>
              {S.lang === "zh" ? n.text.zh : n.text.en}
            </span>
          </button>
        ))}
        {S.notices.length === 0 && <span className="muted">{tr("暂无通知", "Nothing yet")}</span>}
      </div>
    </Sheet>
  );
}

const TITLES: Record<string, [string, string]> = {
  market: ["市场", "Market"],
  confidence: ["信心市场", "Confidence"],
  portfolio: ["持仓", "Portfolio"],
  orders: ["订单", "Orders"],
  me: ["我的", "Me"],
  merchant: ["商户中心", "Merchant center"],
  console: ["平台审核台", "Verifier desk"],
};

export function App() {
  useWorld();
  useTheme();
  const [notices, setNotices] = React.useState(false);

  React.useEffect(() => {
    const fromHash = routeFromHash();
    if (fromHash) S.route = fromHash;
    catchUp();
    const onHash = () => {
      const r = routeFromHash();
      if (r && r !== S.route) {
        S.route = r;
        commit();
      }
    };
    window.addEventListener("hashchange", onHash);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") botTick();
    }, 3200);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => setLang(S.lang), [S.lang]);

  const route = S.route;
  const unread = S.notices.filter((n) => !n.read).length;
  const lv = levelOf(S.me.xp);
  let page: React.ReactNode;
  if (route.startsWith("asset-")) page = <AssetPage id={route.slice(6)} />;
  else if (route === "portfolio") page = <Portfolio />;
  else if (route === "orders") page = <Orders />;
  else if (route === "confidence") page = <Confidence />;
  else if (route === "me") page = <Me />;
  else if (route === "merchant") page = <Merchant />;
  else if (route === "console") page = <Console />;
  else page = <Market />;
  const title = route.startsWith("asset-") ? S.assets.find((a) => a.id === route.slice(6))?.symbol ?? "" : tr(...(TITLES[route] ?? TITLES.market));

  return (
    <div className="shell">
      <nav className="rail" aria-label={tr("主导航", "Main")}>
        <button className="logo" onClick={() => go("market")} aria-label="Slice">
          <span>S</span>
        </button>
        <NavButtons />
        <span className="spacer" />
        <button className="navbtn" aria-current={route === "merchant" ? "page" : undefined} onClick={() => go("merchant")}>
          <IStore />
          <span>{tr("商户", "Merchant")}</span>
        </button>
        <button className="navbtn" aria-current={route === "console" ? "page" : undefined} onClick={() => go("console")}>
          <IShield />
          <span>{tr("审核台", "Verifier")}</span>
        </button>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="title grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
          <div className="timebar hide-sm" title={tr("模拟时间", "Simulated time")}>
            <span className="muted num" style={{ fontSize: 12.5, padding: "0 6px" }}>
              {date(now())}
            </span>
            <button className="btn xs ghost" onClick={() => run(() => fastForward(7))}>
              <IFast /> {tr("+7天", "+7d")}
            </button>
          </div>
          <button className="iconbtn hide-sm" aria-label={tr("切换语言", "Switch language")} onClick={() => ((S.lang = S.lang === "zh" ? "en" : "zh"), setLang(S.lang), commit())}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{S.lang === "zh" ? "EN" : "中"}</span>
          </button>
          <button
            className="iconbtn hide-sm"
            aria-label={tr("切换主题", "Toggle theme")}
            onClick={() => {
              const dark = S.theme === "dark" || (S.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
              S.theme = dark ? "light" : "dark";
              commit();
            }}
          >
            {S.theme === "dark" ? <ISun /> : <IMoon />}
          </button>
          <button className="iconbtn" aria-label={tr("通知", "Notifications")} onClick={() => setNotices(true)}>
            <IBell />
            {unread > 0 && <span className="dot">{unread}</span>}
          </button>
          <button className="level-ring hide-sm" onClick={() => go("me")} aria-label={tr("等级", "Level")}>
            <b>{lv + 1}</b>
            <span className="num">{S.me.xp} XP</span>
          </button>
          <button className="wallet-pill" onClick={() => (S.me.usdt < 50 ? run(faucet) : go("portfolio"))} aria-label={tr("钱包余额", "Wallet balance")}>
            <span className="coin">₮</span>
            <span className="num">{usd(S.me.usdt)}</span>
            {S.me.usdt < 50 && <IGift />}
          </button>
        </header>
        <main className="page" key={route}>
          {page}
        </main>
      </div>

      <nav className="tabbar" aria-label={tr("主导航", "Main")}>
        <NavButtons />
      </nav>
      <Welcome />
      <NoticesSheet open={notices} onClose={() => setNotices(false)} />
      <Effects />
    </div>
  );
}
