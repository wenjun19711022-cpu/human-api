import React from "react";
import type { Asset, Category, DocKind } from "../engine/types";
import { S, commit, getAsset, now, useWorld } from "../engine/store";
import {
  addDraftDoc,
  applyAudit,
  launchRound,
  payDividend,
  raiseCommitment,
  resetDraft,
  run,
  signAgreement,
  submitApplication,
  unanswered,
  updateDraft,
  fastForward,
  faucet,
  merchantGrant,
  contributeDividend,
} from "../engine/actions";
import { roundView } from "../engine/view";
import { agentUrl, coverage, realAudit, simulateAudit, type AuditStep } from "../engine/audit";
import { dueDate, requiredBondPeriods, yieldAt } from "../engine/market";
import { COUNTRIES } from "../engine/geo";
import { CATEGORY, Meter, Seg, StagePill, StatusDot, Stepper, Tile, TrustRing } from "../components/ui";
import { QA } from "../components/AssetParts";
import { IBank, IBuilding, ICheck, IFile, IId, IMarket, IPin, IScale, ISearch, ISpark, IThink, ITool, IUpload, ICamera, IFast, IShield, ILock } from "../components/icons";
import { l, lang, tr } from "../lib/i18n";
import { countdown, date, usd, usdCompact, pct } from "../lib/format";
import { fakeHash, sha256Hex } from "../lib/rand";
import { go } from "../lib/nav";
import { uploadRegistration } from "../engine/actions";

const STEP_ICON: Record<AuditStep["icon"], React.ReactNode> = {
  doc: <IFile />,
  registry: <IBuilding />,
  id: <IId />,
  map: <IPin />,
  social: <ICamera />,
  bank: <IBank />,
  legal: <IScale />,
  score: <ISpark />,
  search: <ISearch />,
  think: <IThink />,
  tool: <ITool />,
};

export function Merchant() {
  useWorld();
  const a = S.me.merchantAssetId ? getAsset(S.me.merchantAssetId) : undefined;
  if (a && a.audit && a.audit.verdict !== "reject") return <Dashboard a={a} />;
  return <Wizard existing={a} />;
}

// ------------------------------------------------------------------ wizard

const STEPS: [string, string][] = [
  ["生意信息", "Business"],
  ["上传材料", "Documents"],
  ["发行条款", "Terms"],
  ["AI 尽调", "AI review"],
  ["公开问答", "Public Q&A"],
];

function Wizard({ existing }: { existing?: Asset }) {
  const d = S.draft;
  const set = (patch: Partial<typeof d>) => {
    updateDraft(patch);
    commit();
  };
  return (
    <>
      <div className="stack tight">
        <span className="eyebrow">{tr("商户中心", "Merchant center")}</span>
        <h1>{tr("把你的生意推上链", "Take your business on-chain")}</h1>
        <p className="soft" style={{ maxWidth: 680 }}>
          {tr(
            "五步完成：填信息、传材料、定条款、AI 尽调、公开问答。之后开启认购，全世界的人用 USDT 买你的份额，钱在你完成工商变更、投资人确认收货后到账。",
            "Five steps: details, documents, terms, AI review, public Q&A. Then open a round: people anywhere buy your shares with USDT, and the money arrives once you register the transfer and investors confirm receipt.",
          )}
        </p>
      </div>
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <button key={i} className={i < d.step ? "done" : i === d.step ? "now" : ""} onClick={() => i < 3 && set({ step: i })} disabled={i >= 3 && d.step < i}>
            <i />
            <span>
              {i + 1}. {tr(...s)}
            </span>
          </button>
        ))}
      </div>
      {existing?.audit?.verdict === "reject" && (
        <div className="callout bad">
          <ISpark />
          <span>{tr("上一次 AI 尽调未通过。请补充缺失的材料或调整条款后重新审核。", "The last AI review didn't pass. Add the missing documents or adjust the terms, then run it again.")}</span>
        </div>
      )}
      {d.step === 0 && <StepBusiness set={set} />}
      {d.step === 1 && <StepDocs set={set} />}
      {d.step === 2 && <StepTerms set={set} />}
      {d.step >= 3 && <StepAudit existing={existing} />}
    </>
  );
}

type Setter = (patch: Partial<typeof S.draft>) => void;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StepBusiness({ set }: { set: Setter }) {
  const d = S.draft;
  return (
    <div className="card stack loose">
      <div className="callout">
        <ISpark />
        <span>{tr("已用一个示例生意预填，直接改成你自己的即可。", "Pre-filled with an example business; replace it with your own.")}</span>
      </div>
      <div className="form-grid">
        <Field label={tr("生意名称", "Business name")}>
          <input className="input" id="m-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={tr("类别", "Category")}>
          <select className="input" id="m-cat" value={d.category} onChange={(e) => set({ category: e.target.value as Category })}>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {tr(...v)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("城市", "City")}>
          <input className="input" id="m-city" value={d.city} onChange={(e) => set({ city: e.target.value })} />
        </Field>
        <Field label={tr("国家/地区", "Country")}>
          <select className="input" id="m-country" value={d.country} onChange={(e) => set({ country: e.target.value })}>
            {Object.entries(COUNTRIES).map(([k, v]) => (
              <option key={k} value={k}>
                {l(v)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("负责人姓名（与证件一致）", "Owner name (as on ID)")}>
          <input className="input" id="m-owner" value={d.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
        </Field>
        <Field label={tr("注册主体名称", "Registered entity name")}>
          <input className="input" id="m-entity" value={d.entityName} onChange={(e) => set({ entityName: e.target.value })} />
        </Field>
        <Field label={tr("Google 地图链接", "Google Maps link")}>
          <input className="input" id="m-maps" value={d.mapsUrl} onChange={(e) => set({ mapsUrl: e.target.value })} />
        </Field>
        <Field label="Instagram">
          <input className="input" id="m-ig" value={d.instagram} onChange={(e) => set({ instagram: e.target.value })} />
        </Field>
        <Field label={tr("月均营收（USDT）", "Monthly revenue (USDT)")}>
          <input className="input num" id="m-rev" inputMode="decimal" value={d.monthlyRevenue} onChange={(e) => set({ monthlyRevenue: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
        </Field>
        <Field label={tr("净利率 %", "Net margin %")}>
          <input className="input num" id="m-margin" inputMode="decimal" value={Math.round(d.margin * 100)} onChange={(e) => set({ margin: (Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) / 100 })} />
        </Field>
      </div>
      <Field label={tr("一句话介绍（投资人会先看到这个）", "One-line pitch (investors see this first)")}>
        <textarea className="input" id="m-about" value={d.about} onChange={(e) => set({ about: e.target.value })} placeholder={tr("例如：温哥华 Main Street 的手拉面馆，开业 4 年，融资用于开第二家店。", "e.g. Hand-pulled noodles on Main Street, Vancouver; four years open; raising for a second shop.")} />
      </Field>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={() => set({ step: 1 })}>
          {tr("下一步：上传材料", "Next: documents")}
        </button>
      </div>
    </div>
  );
}

const DOCS: { kind: DocKind; zh: string; en: string; required: boolean; hint: [string, string] }[] = [
  { kind: "registry", zh: "工商注册文件", en: "Business registration", required: true, hint: ["营业执照 / 公司章程 / 登记摘录", "Licence, articles or registry extract"] },
  { kind: "id", zh: "负责人身份证件", en: "Owner photo ID", required: true, hint: ["护照或身份证，姓名需与登记一致", "Passport or national ID matching the registry"] },
  { kind: "bank", zh: "近 12 个月银行流水", en: "12 months of bank statements", required: true, hint: ["对公账户，AI 会做取证分析", "Business account; the AI runs forensics on it"] },
  { kind: "license", zh: "经营许可", en: "Operating licence", required: false, hint: ["如酒牌、食品经营许可", "e.g. liquor or food licence"] },
  { kind: "lease", zh: "店面租约", en: "Premises lease", required: false, hint: ["到期日与续租条款", "End date and renewal terms"] },
  { kind: "pos", zh: "POS / 收款平台只读授权", en: "POS / payments read-only grant", required: false, hint: ["Square、Stripe、Shopify 等", "Square, Stripe, Shopify and so on"] },
];

function StepDocs({ set }: { set: Setter }) {
  const d = S.draft;
  const [busy, setBusy] = React.useState<string | null>(null);
  const onFile = async (kind: DocKind, name: string, file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    const hash = await sha256Hex(await file.arrayBuffer());
    addDraftDoc(kind, `${name} · ${file.name}`, hash);
    setBusy(null);
    commit();
  };
  return (
    <div className="card stack loose">
      <div className="callout">
        <ILock />
        <span>
          {tr(
            "文件在你的浏览器里计算 SHA-256 指纹，只有指纹写上链存证；原件交给 AI 和审核员核验。随时可以在问答期补充。",
            "Each file is fingerprinted (SHA-256) in your browser and only the fingerprint goes on-chain; the AI and verifiers read the originals. You can add more during Q&A.",
          )}
        </span>
      </div>
      <div className="card flush list">
        {DOCS.map((doc) => {
          const got = d.docs.find((x) => x.kind === doc.kind);
          return (
            <div key={doc.kind} className={`upload ${got ? "ok" : ""}`}>
              <span className="ic">{got ? <ICheck /> : <IUpload />}</span>
              <div className="stack tight" style={{ gap: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>
                  {tr(doc.zh, doc.en)} {doc.required && <span className="down">*</span>}
                </b>
                <span className="muted" style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>
                  {got ? <span className="mono">{got.hash.slice(0, 18)}…</span> : tr(...doc.hint)}
                </span>
              </div>
              <div className="row">
                <label className="btn xs ghost" htmlFor={`f-${doc.kind}`}>
                  {busy === doc.kind ? "…" : got ? tr("替换", "Replace") : tr("上传", "Upload")}
                </label>
                <input id={`f-${doc.kind}`} type="file" accept=".pdf,image/*" className="sr" onChange={(e) => onFile(doc.kind, tr(doc.zh, doc.en), e.target.files?.[0])} />
                {!got && (
                  <button
                    className="btn xs quiet"
                    onClick={() => {
                      addDraftDoc(doc.kind, tr(`${doc.zh}（示例）`, `${doc.en} (sample)`), fakeHash(doc.kind + d.name));
                      commit();
                    }}
                  >
                    {tr("用示例", "Sample")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="spread">
        <button className="btn quiet" onClick={() => set({ step: 0 })}>
          {tr("上一步", "Back")}
        </button>
        <button className="btn primary" onClick={() => set({ step: 2 })}>
          {tr("下一步：发行条款", "Next: terms")}
        </button>
      </div>
    </div>
  );
}

function StepTerms({ set }: { set: Setter }) {
  const d = S.draft;
  const cover = coverage(d);
  const annual = (d.perPeriod * 365) / d.periodDays;
  const y = annual / d.target;
  const valuation = d.instrument === "equity" ? d.target / (d.companyPct / 100) : null;
  const num = (v: string) => Number(v.replace(/[^0-9.]/g, "")) || 0;
  return (
    <div className="two" style={{ alignItems: "start" }}>
      <div className="card stack loose">
        <Field label={tr("出让什么", "What you're selling")}>
          <Seg
            value={d.instrument}
            onChange={(v) => set({ instrument: v })}
            items={[
              { id: "equity", label: tr("股权", "Equity") },
              { id: "dividend_rights", label: tr("分红权", "Dividends") },
              { id: "revenue_share", label: tr("收入分成", "Revenue") },
            ]}
          />
        </Field>
        <div className="form-grid">
          <Field label={d.instrument === "revenue_share" ? tr("分出收入比例 %", "Share of revenue %") : tr("出让比例 %", "Share sold %")}>
            <input className="input num" id="t-pct" value={d.companyPct} onChange={(e) => set({ companyPct: Math.min(100, num(e.target.value)) })} />
          </Field>
          <Field label={tr("融资目标（USDT）", "Raise target (USDT)")}>
            <input className="input num" id="t-target" value={d.target} onChange={(e) => set({ target: num(e.target.value) })} />
          </Field>
          <Field label={tr("最低成团 %", "Minimum to close %")}>
            <input className="input num" id="t-min" value={d.minRaisePct} onChange={(e) => set({ minRaisePct: Math.min(100, num(e.target.value)) })} />
          </Field>
          <Field label={tr("认购天数", "Round length (days)")}>
            <input className="input num" id="t-days" value={d.durationDays} onChange={(e) => set({ durationDays: num(e.target.value) })} />
          </Field>
          <Field label={tr("每期承诺分红（USDT）", "Promised per period (USDT)")}>
            <input className="input num" id="t-div" value={d.perPeriod} onChange={(e) => set({ perPeriod: num(e.target.value) })} />
          </Field>
          <Field label={tr("分红周期", "Period")}>
            <select className="input" id="t-period" value={d.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })}>
              <option value={30}>{tr("每月", "Monthly")}</option>
              <option value={91}>{tr("每季度", "Quarterly")}</option>
            </select>
          </Field>
          <Field label={tr("承诺期数", "Number of periods")}>
            <input className="input num" id="t-n" value={d.numPeriods} onChange={(e) => set({ numPeriods: Math.max(1, Math.min(60, num(e.target.value))) })} />
          </Field>
          <Field label={tr("定价方式", "Pricing")}>
            <Seg
              value={d.pricing}
              onChange={(v) => set({ pricing: v })}
              items={[
                { id: "auction", label: tr("市场出价", "Market bids") },
                { id: "fixed", label: tr("固定价", "Fixed") },
              ]}
            />
          </Field>
        </div>
        <div className="spread">
          <button className="btn quiet" onClick={() => set({ step: 1 })}>
            {tr("上一步", "Back")}
          </button>
          <button className="btn primary" onClick={() => set({ step: 3 })}>
            {tr("下一步：AI 尽调", "Next: AI review")}
          </button>
        </div>
      </div>
      <div className="stack">
        <div className="card stack">
          <span className="eyebrow">{tr("投资人会看到", "What investors see")}</span>
          <div className="row" style={{ gap: 12 }}>
            <Tile a={{ symbol: (d.name.match(/[A-Z]/g) ?? ["B", "I", "Z"]).join("").slice(0, 4) || "BIZ", hue: 200, category: d.category }} />
            <div className="grow">
              <b>{d.name}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {d.city} · {tr(...(CATEGORY[d.category] ?? CATEGORY.bar))}
              </div>
            </div>
          </div>
          <div className="kv">
            <div>
              <span className="k">{tr("首发价", "Launch price")}</span>
              <span className="v">$1.00</span>
              <span className="s">{tr(`${d.target.toLocaleString()} 份`, `${d.target.toLocaleString()} shares`)}</span>
            </div>
            <div>
              <span className="k">{tr("承诺年化", "Promised yield")}</span>
              <span className="v gold">{pct(y)}</span>
              <span className="s">{tr(`每年 ${usd(annual)}`, `${usd(annual)} a year`)}</span>
            </div>
            {valuation && (
              <div>
                <span className="k">{tr("隐含估值", "Implied valuation")}</span>
                <span className="v">{usdCompact(valuation)}</span>
              </div>
            )}
            <div>
              <span className="k">{tr("保证金（按信任分定价）", "Bond (priced by trust)")}</span>
              <span className="v">
                {usd(d.perPeriod)} – {usd(d.perPeriod * 4)}
              </span>
              <span className="s">{tr("A 1 期 · B 2 期 · C 3 期 · 更低 4 期", "A 1 · B 2 · C 3 · lower 4 periods")}</span>
            </div>
            <div>
              <span className="k">{tr("定价", "Pricing")}</span>
              <span className="v">{d.pricing === "auction" ? "$1.00 – $1.28" : "$1.00"}</span>
              <span className="s">{d.pricing === "auction" ? tr("投资人出价，统一清算", "investors bid, one clearing price") : tr("超额按比例分配", "oversubscription pro rata")}</span>
            </div>
          </div>
        </div>
        <div className={`callout ${cover >= 1.2 ? "good" : cover >= 1 ? "warn" : "bad"}`}>
          <IShield />
          <span>
            {tr(
              `分红覆盖率 ${cover.toFixed(2)} 倍：按你申报的营收和利润率，${d.instrument === "revenue_share" ? "分出的收入" : "出让部分对应的利润"}是承诺金额的 ${cover.toFixed(2)} 倍。${cover < 1 ? "低于 1 倍会被 AI 判为高风险，建议降低承诺或多出让一些。" : cover < 1.2 ? "偏紧，一个淡季就可能触发违约罚没。" : "健康。"}`,
              `Dividend cover ${cover.toFixed(2)}×: on your declared numbers, ${d.instrument === "revenue_share" ? "the revenue share" : "the profit attached to what you sell"} is ${cover.toFixed(2)}× the promise. ${cover < 1 ? "Below 1× the AI flags it as high risk; promise less or sell more." : cover < 1.2 ? "Tight: one slow season could trigger a slash." : "Healthy."}`,
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function StepAudit({ existing }: { existing?: Asset }) {
  const [steps, setSteps] = React.useState<AuditStep[]>([]);
  const [phase, setPhase] = React.useState<"idle" | "running" | "error">("idle");
  const [err, setErr] = React.useState("");
  const d = S.draft;
  const live = agentUrl();
  const start = async () => {
    setSteps([]);
    setErr("");
    setPhase("running");
    let id = existing?.id;
    if (!id) id = run(submitApplication);
    else {
      existing!.docs = d.docs.map((x) => ({ ...x }));
      existing!.audit = null;
    }
    if (!id) {
      setPhase("idle");
      return;
    }
    const onStep = (s: AuditStep, i: number) =>
      setSteps((prev) => {
        const next = [...prev];
        next[i] = s;
        return next;
      });
    try {
      const res = live ? await realAudit(d, lang(), onStep) : await simulateAudit(d, onStep);
      run(() => applyAudit(id!, res.audit, res.questions));
      updateDraft({ step: 4 });
      commit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };
  return (
    <div className="card stack loose">
      <div className="spread wrap">
        <div className="stack tight">
          <h2>{tr("AI 尽调", "AI due diligence")}</h2>
          <p className="soft" style={{ fontSize: 14, maxWidth: 620 }}>
            {live
              ? tr("已连接 Claude 尽调 Agent：它会实时搜索 Google 地图、社媒、工商登记库与新闻，并对你的流水做取证分析。", "Connected to the Claude due-diligence agent: it searches Maps, social media, registries and news live, and runs forensics on your statements.")
              : tr("AI 会比对工商登记、身份证件、Google 地图、社媒与银行流水，给出信任分、风险点，并替投资人先问出最难的问题。", "The AI cross-checks the registry, ID, Google Maps, social media and bank statements, then gives a trust score, flags risks and asks investors' hardest questions first.")}
          </p>
        </div>
        {phase !== "running" && (
          <button className="btn primary" onClick={start}>
            <ISpark /> {steps.length ? tr("重新审核", "Run again") : tr("开始 AI 尽调", "Start AI review")}
          </button>
        )}
      </div>
      {steps.length > 0 && (
        <div className="card flush list">
          {steps.map((s, i) => (
            <div key={i} className="audit-check">
              <StatusDot s={s.status} />
              <div className="stack tight" style={{ gap: 2, minWidth: 0 }}>
                <b className="row" style={{ fontSize: 14, gap: 6 }}>
                  <span className="muted" style={{ display: "inline-flex", width: 16 }}>
                    {STEP_ICON[s.icon]}
                  </span>
                  {l(s.title)}
                </b>
                <span className="soft" style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>
                  {l(s.detail)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {phase === "error" && (
        <div className="callout bad">
          <ISpark />
          <span>
            {tr("审核没有完成：", "The review didn't finish: ")}
            {err}
          </span>
        </div>
      )}
      <div className="row">
        <button className="btn quiet" onClick={() => (updateDraft({ step: 2 }), commit())} disabled={phase === "running"}>
          {tr("上一步", "Back")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

function Dashboard({ a }: { a: Asset }) {
  const t = now();
  const o = a.offering;
  const c = a.commitment;
  const open = unanswered(a);
  const [days, setDays] = React.useState(14);
  const [raise, setRaise] = React.useState(String(Math.round(c.perPeriod * 1.2)));
  const next = c.status.indexOf("pending");
  const due = next === -1 ? null : dueDate(c, next);
  const bondPeriods = requiredBondPeriods(a.audit?.trustScore ?? 0, S.me.merchantDefaults);
  const bond = a.stage === "qa" ? c.perPeriod * bondPeriods : c.bond;
  const [installment, setInstallment] = React.useState(String(Math.round(c.perPeriod / 4)));
  const rv = roundView(a);

  const onFileHash = (fn: (h: string) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    fn(await sha256Hex(await f.arrayBuffer()));
  };

  return (
    <>
      <div className="spread wrap">
        <div className="row" style={{ gap: 14 }}>
          <Tile a={a} size="lg" />
          <div className="stack tight">
            <span className="eyebrow">{tr("商户中心", "Merchant center")}</span>
            <h1>{a.name}</h1>
            <div className="row wrap">
              <StagePill a={a} />
              <TrustRing audit={a.audit} size={30} showLabel />
            </div>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go(`asset-${a.id}`)}>
          <IMarket /> {tr("查看公开页面", "View public page")}
        </button>
      </div>
      <Stepper a={a} />

      {a.stage === "qa" && (
        <div className="two" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className={`callout ${open ? "warn" : "good"}`}>
              <ISpark />
              <span>
                {open
                  ? tr(`还有 ${open} 个问题待回答。AI 尽调官和投资人的问题都要公开回答，回答会归档进发行文件，并影响你的信任分。`, `${open} question(s) to answer. Answer the agent's and investors' questions in public; answers are filed with the offering and affect your trust score.`)
                  : tr("所有问题都已回答，可以开启认购了。", "Every question is answered; you can open the round.")}
              </span>
            </div>
            <QA a={a} merchant />
          </div>
          <div className="card stack">
            <h3>{tr("开启认购", "Open the round")}</h3>
            <Field label={tr("认购天数", "Round length")}>
              <Seg
                value={String(days) as "7" | "14" | "21"}
                onChange={(v) => setDays(Number(v))}
                items={[
                  { id: "7", label: tr("7 天", "7 days") },
                  { id: "14", label: tr("14 天", "14 days") },
                  { id: "21", label: tr("21 天", "21 days") },
                ]}
              />
            </Field>
            <div className="kv">
              <div>
                <span className="k">{tr("融资目标", "Target")}</span>
                <span className="v">{usdCompact(o.sharesForSale * o.prices[0])}</span>
              </div>
              <div>
                <span className="k">{tr("保证金", "Bond")}</span>
                <span className="v">{usd(bond)}</span>
                <span className="s">{tr(`${bondPeriods} 期 · 信任分 ${a.audit?.trustScore ?? "—"}`, `${bondPeriods} period(s) · score ${a.audit?.trustScore ?? "—"}`)}</span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {tr(
                `保证金倍数由 AI 信任分决定（A 1 期 · B 2 期 · C 3 期 · 更低 4 期）${S.me.merchantDefaults ? `，你有 ${S.me.merchantDefaults} 次违约记录，多押 ${S.me.merchantDefaults} 期` : ""}。按时分红就不会被动用，全部期数结束后退回。`,
                `The bond multiple comes from your AI trust score (A 1 · B 2 · C 3 · lower 4 periods)${S.me.merchantDefaults ? `, plus ${S.me.merchantDefaults} for your default record` : ""}. Pay on time and it's never touched; it comes back after the last period.`,
              )}
            </p>
            {S.me.usdt < bond && (
              <div className="callout warn">
                <ILock />
                <div className="stack tight grow">
                  <span>{tr(`保证金需要 ${usd(bond)}，你的余额只有 ${usd(S.me.usdt)}。`, `The bond is ${usd(bond)} and your balance is ${usd(S.me.usdt)}.`)}</span>
                  <button className="btn sm primary" onClick={() => run(S.me.granted ? faucet : merchantGrant)}>
                    {S.me.granted ? tr("领取 1,000 测试 USDT", "Get 1,000 test USDT") : tr("领取商户测试资金 $10,000", "Get $10,000 merchant test funds")}
                  </button>
                </div>
              </div>
            )}
            <button className="btn primary block" disabled={open > 0 || S.me.usdt < bond} onClick={() => run(() => launchRound(a.id, days))}>
              <ILock /> {tr(`存入 ${usd(bond)} 保证金并开启认购`, `Post ${usd(bond)} bond and open`)}
            </button>
          </div>
        </div>
      )}

      {a.stage === "ipo" && (
        <div className="two">
          <div className="card stack">
            <h3>{tr("认购进行中", "Round in progress")}</h3>
            <Meter value={Math.min(1, rv.coverage)} />
            <div className="kv">
              <div>
                <span className="k">{tr("已认购", "Committed")}</span>
                <span className="v">{usdCompact(o.committed)}</span>
                <span className="s">{tr(`${rv.coverage.toFixed(2)} 倍`, `${rv.coverage.toFixed(2)}x`)}</span>
              </div>
              <div>
                <span className="k">{tr("预计清算价", "Clearing now")}</span>
                <span className="v">${rv.clearing.price.toFixed(4)}</span>
                <span className="s">{tr(`预计融到 ${usdCompact(rv.clearing.raised)}`, `${usdCompact(rv.clearing.raised)} raised`)}</span>
              </div>
              <div>
                <span className="k">{tr("认购人数", "Investors")}</span>
                <span className="v">{o.investors}</span>
              </div>
              <div>
                <span className="k">{tr("截止", "Closes")}</span>
                <span className="v">{countdown(o.deadline, t)}</span>
              </div>
            </div>
            <p className="soft" style={{ fontSize: 13.5 }}>
              {tr("这些钱都在托管合约里，你现在还拿不到。成团后签约、完成工商变更，投资人确认收货时逐笔到账。", "This money is in escrow and not yours yet. After the round fills you sign and register the transfer, and each investor's payment arrives when they confirm receipt.")}
            </p>
          </div>
          <div className="card stack">
            <h3>{tr("想看后面会发生什么？", "Want to see what happens next?")}</h3>
            <p className="soft" style={{ fontSize: 13.5 }}>{tr("全球的模拟投资人正在认购。快进时间就能看到成团。", "Simulated investors worldwide are subscribing. Skip ahead to watch it fill.")}</p>
            <button className="btn ghost" onClick={() => run(() => fastForward(7))}>
              <IFast /> {tr("快进 7 天", "Skip 7 days")}
            </button>
          </div>
        </div>
      )}

      {a.stage === "settling" && (
        <div className="card stack loose">
          <h3>{tr("交割：把份额真正交给投资人", "Settlement: hand the shares over")}</h3>
          <div className="timeline">
            <div className={`tl ${o.agreementHash ? "done" : "now"}`}>
              <span className="node">{o.agreementHash ? <ICheck /> : null}</span>
              <div className="stack tight">
                <span className="t">{tr("1. 签署股份转让协议", "1. Sign the share transfer agreement")}</span>
                <span className="d">
                  {o.agreementHash
                    ? `${tr("已签署", "Signed")} · ${o.agreementHash.slice(0, 18)}…`
                    : tr(`交割截止：${countdown(o.settleDeadline ?? t, t)}后`, `Deadline in ${countdown(o.settleDeadline ?? t, t)}`)}
                </span>
                {!o.agreementHash && (
                  <div className="row wrap">
                    <button className="btn sm primary" onClick={() => run(() => signAgreement(a.id, fakeHash(a.id + "sig" + t)))}>
                      {tr("电子签名", "Sign electronically")}
                    </button>
                    <label className="btn sm ghost" htmlFor="sign-file">
                      {tr("上传已签 PDF", "Upload signed PDF")}
                    </label>
                    <input id="sign-file" type="file" accept=".pdf" className="sr" onChange={onFileHash((h) => run(() => signAgreement(a.id, h)))} />
                  </div>
                )}
              </div>
            </div>
            <div className={`tl ${o.registrationProof ? "done" : o.agreementHash ? "now" : ""}`}>
              <span className="node">{o.registrationProof ? <ICheck /> : null}</span>
              <div className="stack tight">
                <span className="t">{tr("2. 完成工商变更，上传证明", "2. Register the transfer and upload proof")}</span>
                <span className="d">{tr("例如变更后的登记摘录、股东名册、会员登记表", "e.g. the updated registry extract, share register or membership ledger")}</span>
                {o.agreementHash && !o.registrationProof && (
                  <div className="row wrap">
                    <label className="btn sm primary" htmlFor="proof-file">
                      <IUpload /> {tr("上传登记证明", "Upload proof")}
                    </label>
                    <input id="proof-file" type="file" accept=".pdf,image/*" className="sr" onChange={onFileHash((h) => run(() => uploadRegistration(a.id, h)))} />
                    <button className="btn sm ghost" onClick={() => run(() => uploadRegistration(a.id, fakeHash(a.id + "proof")))}>
                      {tr("用示例证明", "Use sample proof")}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className={`tl ${o.deliveredAt ? "done" : o.registrationProof ? "now" : ""}`}>
              <span className="node">{o.deliveredAt ? <ICheck /> : null}</span>
              <div className="stack tight">
                <span className="t">{tr("3. 平台核验，投资人确认收货", "3. Platform verifies; investors confirm receipt")}</span>
                <span className="d">{tr("核验后资金按投资人确认逐笔到账，7 天后未确认的自动放款。", "After verification, payments arrive as investors confirm; unconfirmed ones release automatically after 7 days.")}</span>
                {o.registrationProof && !o.deliveredAt && (
                  <button className="btn sm ghost" onClick={() => go("console")}>
                    <IShield /> {tr("去平台审核台核验", "Verify at the desk")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {a.stage === "trading" && (
        <>
          <div className="kv">
            <div>
              <span className="k">{tr("已到账融资", "Funds received")}</span>
              <span className="v up">{usd(o.merchantReceived)}</span>
              <span className="s">{tr("已扣 3% 平台费", "after the 3% fee")}</span>
            </div>
            <div>
              <span className="k">{tr("当前股价", "Share price")}</span>
              <span className="v">${a.price.toFixed(2)}</span>
              <span className="s">{tr(`承诺年化 ${pct(yieldAt(a))}`, `${pct(yieldAt(a))} yield`)}</span>
            </div>
            <div>
              <span className="k">{tr("保证金", "Bond")}</span>
              <span className="v">{usd(c.bond)}</span>
            </div>
            <div>
              <span className="k">{tr("持有人", "Holders")}</span>
              <span className="v">{Math.max(a.holders, o.investors)}</span>
            </div>
          </div>
          <div className="two" style={{ alignItems: "start" }}>
            <div className="card stack">
              <h3>{tr("本期分红", "This period's dividend")}</h3>
              {next === -1 || !due ? (
                <p className="soft">{tr("全部期数已结算。", "All periods are settled.")}</p>
              ) : (
                <>
                  <div className="spread">
                    <span className="big-price gold">{usd(c.perPeriod - c.credit[next])}</span>
                    <span className="muted" style={{ textAlign: "right", fontSize: 13 }}>
                      {tr(`第 ${next + 1} 期还差 · ${date(due)}`, `Still owed for period ${next + 1} · ${date(due)}`)}
                      <br />
                      {t < due ? countdown(due, t) : tr(`宽限期剩 ${countdown(due + c.graceDays * 86_400_000, t)}`, `${countdown(due + c.graceDays * 86_400_000, t)} of grace left`)}
                    </span>
                  </div>
                  <div className="stack tight">
                    <div className="spread muted" style={{ fontSize: 12.5 }}>
                      <span>{a.router ? tr("收入直连已到账", "Arrived via direct revenue") : tr("本期已付", "Paid so far")}</span>
                      <span className="num">
                        {usd(c.credit[next])} / {usd(c.perPeriod)}
                      </span>
                    </div>
                    <Meter value={c.credit[next] / c.perPeriod} tone="gold" />
                  </div>
                  {t > due && (
                    <div className="callout bad">
                      <ILock />
                      <span>{tr("已过到期日。宽限期结束仍未付足，保证金会补差额给持有人，平台这一期的费用也让给持有人，违约永久记录并提高你以后的保证金。", "Past due. If still short when grace ends, the bond covers the gap for holders, the platform forfeits this period's fee to them, and the default is recorded and raises your future bonds.")}</span>
                    </div>
                  )}
                  {a.router && (
                    <div className="callout">
                      <ISpark />
                      <span style={{ fontSize: 13 }}>
                        {tr(
                          `收入直连：付款方每天把钱打进路由合约，${a.router.holderBps / 100}% 自动计入本期承诺，其余直接到你钱包。累计已给持有人 ${usdCompact(a.router.toHolders)}。`,
                          `Direct revenue: payers send money into the router daily; ${a.router.holderBps / 100}% counts toward this period automatically and the rest lands in your wallet. ${usdCompact(a.router.toHolders)} to holders so far.`,
                        )}
                      </span>
                    </div>
                  )}
                  <button className="btn gold lg block" onClick={() => run(() => payDividend(a.id, next))}>
                    {tr(`补足第 ${next + 1} 期（${usd(c.perPeriod - c.credit[next])}）`, `Pay the rest of period ${next + 1} (${usd(c.perPeriod - c.credit[next])})`)}
                  </button>
                  <div className="row">
                    <input className="input num" id="installment" value={installment} onChange={(e) => setInstallment(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={tr("分期金额", "Installment")} />
                    <button className="btn ghost" onClick={() => run(() => contributeDividend(a.id, Number(installment)))}>
                      {tr("先付一部分", "Pay a part now")}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    {tr("可以按周或按天把营业款打进合约，钱立即按持股分给持有人，自动计入最早一期承诺。", "Pay weekly or daily from your takings: it goes to holders immediately and fills the earliest open period.")}
                  </p>
                </>
              )}
            </div>
            <div className="card stack">
              <h3>{tr("提高承诺，提升股价", "Promise more, lift the price")}</h3>
              <p className="soft" style={{ fontSize: 13.5 }}>
                {tr("承诺越高、保证金越足，市场给的价格越高。提高承诺需要同步追加保证金。", "A bigger, better-bonded promise earns a higher price. Raising it requires topping up the bond.")}
              </p>
              <div className="row">
                <input className="input num" id="raise" value={raise} onChange={(e) => setRaise(e.target.value.replace(/[^0-9.]/g, ""))} />
                <button className="btn primary" onClick={() => run(() => raiseCommitment(a.id, Number(raise)))}>
                  {tr("提高", "Raise")}
                </button>
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {tr(`当前每期 ${usd(c.perPeriod)}，保证金 ${usd(c.bond)}（需覆盖 ${c.bondPeriods} 期）`, `Now ${usd(c.perPeriod)} per period with a ${usd(c.bond)} bond (must cover ${c.bondPeriods} period(s))`)}
              </span>
            </div>
          </div>
          <QA a={a} merchant />
        </>
      )}

      {a.stage === "failed" && (
        <div className="card stack">
          <h3>{tr("这一轮没有成功", "This round didn't complete")}</h3>
          <p className="soft">{tr("所有投资人的资金已可全额退回，你的保证金也已退还。调整条款后可以重新申请。", "Every investor can refund in full and your bond was returned. Adjust the terms and apply again.")}</p>
          <button
            className="btn primary"
            onClick={() => {
              S.me.merchantAssetId = null;
              resetDraft();
              commit();
            }}
          >
            {tr("重新申请", "Start a new application")}
          </button>
        </div>
      )}
    </>
  );
}
