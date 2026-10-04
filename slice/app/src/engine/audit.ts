/**
 * The AI due-diligence step of the merchant wizard.
 * - With VITE_AGENT_URL set, it streams the real agent in slice/agent (Claude + web search + registry +
 *   Google Places + cash-flow forensics) and maps its report into the app.
 * - Without it, a local simulation scores the draft from what the merchant actually entered, so changing
 *   the terms or skipping a document changes the outcome.
 */
import type { Audit, Check, Draft, L, Severity } from "./types";
import { fakeHash, hashString, mulberry32 } from "../lib/rand";
import { now } from "./store";

const L_ = (zh: string, en: string): L => ({ zh, en });

export type StepIcon = "doc" | "registry" | "id" | "map" | "social" | "bank" | "legal" | "score" | "search" | "think" | "tool";
export interface AuditStep {
  icon: StepIcon;
  title: L;
  detail: L;
  status: "run" | "pass" | "warn" | "fail" | "info";
}

export interface AuditResult {
  audit: Audit;
  questions: L[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gradeOf(s: number): Audit["grade"] {
  return s >= 85 ? "A" : s >= 75 ? "B" : s >= 60 ? "C" : s >= 45 ? "D" : "F";
}

/** Same statistic the agent's cashflow_forensics tool computes. */
function coefficientOfVariation(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
  return mean ? sd / mean : 0;
}

export function coverage(d: Draft): number {
  const yearlyProfit = d.monthlyRevenue * 12 * d.margin;
  const share = d.instrument === "revenue_share" ? (d.monthlyRevenue * 12 * d.companyPct) / 100 : (yearlyProfit * d.companyPct) / 100;
  const promised = (d.perPeriod * 365) / d.periodDays;
  return promised ? share / promised : 0;
}

export async function simulateAudit(d: Draft, onStep: (s: AuditStep, index: number) => void): Promise<AuditResult> {
  const r = mulberry32(hashString(d.name + d.city));
  const has = (k: string) => d.docs.some((x) => x.kind === k);
  const rating = Math.round((4.2 + r() * 0.6) * 10) / 10;
  const reviews = Math.round(180 + r() * 1800);
  const followers = Math.round(1_500 + r() * 18_000);
  const lastPost = Math.round(1 + r() * 9);
  const monthly = Array.from({ length: 12 }, () => d.monthlyRevenue * (0.9 + r() * 0.2));
  const cv = coefficientOfVariation(monthly);
  const cover = coverage(d);
  const steps: AuditStep[] = [];
  let i = 0;
  const emit = async (s: AuditStep, ms = 900) => {
    const idx = i++;
    onStep({ ...s, status: "run" }, idx);
    await sleep(ms);
    steps.push(s);
    onStep(s, idx);
  };

  await emit({
    icon: "doc",
    title: L_("读取上传文件", "Reading uploaded documents"),
    detail: L_(`共 ${d.docs.length} 份文件，已提取主体名称、负责人姓名、账户户名和存款记录。`, `${d.docs.length} file(s); extracted entity name, owner, account holder and deposits.`),
    status: d.docs.length >= 3 ? "pass" : "warn",
  }, 800);
  await emit({
    icon: "registry",
    title: L_("工商登记库比对", "Business registry lookup"),
    detail: has("registry")
      ? L_(`${d.entityName}：状态“存续”，登记负责人 ${d.ownerName}，与申请一致。`, `${d.entityName}: active; registered officer ${d.ownerName} matches the application.`)
      : L_(`未上传工商文件，只能在公开登记库中按名称模糊匹配 ${d.entityName}，无法确认控制人。`, `No registry document uploaded; ${d.entityName} could only be fuzzy-matched by name, so control is unconfirmed.`),
    status: has("registry") ? "pass" : "warn",
  }, 1100);
  await emit({
    icon: "id",
    title: L_("身份与控制人核验", "Identity & control"),
    detail: has("id")
      ? L_(`证件姓名 ${d.ownerName} 与登记负责人、银行账户户名一致。`, `ID name ${d.ownerName} matches the registered officer and the bank account holder.`)
      : L_("未上传身份证件，无法把申请人和这门生意绑定。", "No ID uploaded, so the applicant can't be tied to the business."),
    status: has("id") ? "pass" : "fail",
  }, 900);
  await emit({
    icon: "map",
    title: L_("Google 地图", "Google Maps"),
    detail: d.mapsUrl
      ? L_(`${d.name}, ${d.city} → ${rating} ★（${reviews} 条评价），营业中，地址与登记一致。`, `${d.name}, ${d.city} → ${rating}★ (${reviews} reviews), operational, address matches the registry.`)
      : L_("未提供地图链接，按名称搜索到 2 个同名地点，无法确定是哪一家。", "No Maps link; a name search found two places with this name."),
    status: d.mapsUrl ? (rating >= 4.3 ? "pass" : "warn") : "warn",
  }, 1300);
  await emit({
    icon: "social",
    title: L_("社交媒体", "Social media"),
    detail: d.instagram
      ? L_(`${d.instagram}：${followers.toLocaleString()} 粉丝，最近更新 ${lastPost} 天前，定位标签与门店地址一致，互动率正常。`, `${d.instagram}: ${followers.toLocaleString()} followers, last post ${lastPost} days ago, location tags match, normal engagement.`)
      : L_("未提供社媒账号。", "No social account provided."),
    status: d.instagram ? "pass" : "info",
  }, 1000);
  await emit({
    icon: "bank",
    title: L_("银行流水取证", "Bank-statement forensics"),
    detail: has("bank")
      ? L_(
          `12 个月存款均值 $${Math.round(d.monthlyRevenue).toLocaleString()}，波动系数 ${cv.toFixed(2)}；承诺分红覆盖率 ${cover.toFixed(2)} 倍。`,
          `12-month average deposits $${Math.round(d.monthlyRevenue).toLocaleString()}, CV ${cv.toFixed(2)}; dividend cover ${cover.toFixed(2)}×.`,
        )
      : L_(`未上传银行流水，只能使用申报营收；承诺分红覆盖率（按申报）${cover.toFixed(2)} 倍。`, `No bank statements; using declared revenue only. Cover on declared numbers: ${cover.toFixed(2)}×.`),
    status: !has("bank") ? "warn" : cover >= 1.2 ? "pass" : cover >= 1 ? "warn" : "fail",
  }, 1400);
  await emit({
    icon: "legal",
    title: L_("诉讼、执照与制裁名单", "Lawsuits, licences & sanctions"),
    detail: has("license")
      ? L_("经营许可有效；法院记录、OFAC / 联合国制裁名单均未命中。", "Operating licence valid; no court records or OFAC/UN sanctions hits.")
      : L_("法院记录与制裁名单未命中；未上传经营许可，需在问答中补充。", "No court or sanctions hits; no operating licence uploaded yet, to be supplied in Q&A."),
    status: has("license") ? "pass" : "warn",
  }, 1000);

  const identity = has("id") ? (has("registry") ? 23 : 15) : 0;
  const registry = has("registry") ? 18 : 8;
  const presence = Math.round(Math.min(20, (d.mapsUrl ? 10 : 4) + (rating - 4) * 12 + (d.instagram ? 4 : 0)));
  let financials = has("bank") ? 14 : 7;
  financials += cover >= 1.5 ? 9 : cover >= 1.2 ? 6 : cover >= 1 ? 2 : -5;
  financials = Math.max(0, Math.min(25, financials - (cv > 0.3 ? 4 : 0)));
  const legal = has("license") ? 9 : 6;
  const trustScore = Math.max(0, Math.min(100, identity + registry + presence + financials + legal));

  const flags: Audit["flags"] = [];
  const flag = (severity: Severity, title: L, detail: L) => flags.push({ severity, title, detail });
  if (!has("id")) flag("high", L_("无法核验申请人身份", "Applicant identity unverified"), L_("请上传负责人身份证件。", "Upload the owner's photo ID."));
  if (cover < 1) flag("high", L_("承诺分红超过可分配利润", "Promise exceeds distributable profit"), L_(`按申报数据，利润只能覆盖承诺分红的 ${(cover * 100).toFixed(0)}%。降低承诺或出让更多份额。`, `On the declared numbers profit covers only ${(cover * 100).toFixed(0)}% of the promise. Promise less or sell more.`));
  else if (cover < 1.2) flag("medium", L_("分红覆盖率偏低", "Thin dividend cover"), L_(`覆盖率 ${cover.toFixed(2)} 倍，一个淡季就可能违约。`, `Cover is ${cover.toFixed(2)}×; one slow season could cause a default.`));
  if (!has("bank")) flag("medium", L_("缺少银行流水", "No bank statements"), L_("营收为自报数据，未经独立核验。", "Revenue is self-reported and unverified."));
  if (!has("registry")) flag("medium", L_("缺少工商文件", "No registry document"), L_("无法确认公司存续状态和控制人。", "Can't confirm the entity's status or who controls it."));
  if (!has("license")) flag("low", L_("经营许可未上传", "Licence not uploaded"), L_("需在问答期补充。", "To be supplied during Q&A."));
  if (cv > 0.3) flag("medium", L_("营收波动大", "Volatile revenue"), L_(`月度波动系数 ${cv.toFixed(2)}。`, `Monthly CV ${cv.toFixed(2)}.`));

  const verdict: Audit["verdict"] = trustScore < 50 || identity === 0 ? "reject" : trustScore >= 70 && !flags.some((f) => f.severity === "high") ? "pass" : "review";

  await emit({
    icon: "score",
    title: L_("生成信任评分", "Scoring"),
    detail: L_(`信任分 ${trustScore}/100（${gradeOf(trustScore)}）`, `Trust score ${trustScore}/100 (${gradeOf(trustScore)})`),
    status: verdict === "pass" ? "pass" : verdict === "review" ? "warn" : "fail",
  }, 700);

  const checks: Check[] = steps
    .filter((s) => s.icon !== "doc" && s.icon !== "score")
    .map((s) => ({
      category: ({ registry: "registry", id: "identity", map: "presence", social: "reputation", bank: "financials", legal: "legal" } as const)[s.icon as "registry"] ?? "legal",
      title: s.title,
      status: s.status === "pass" ? "pass" : s.status === "fail" ? "fail" : s.status === "info" ? "unknown" : "warn",
      finding: s.detail,
      evidence: [],
    }));

  const questions: L[] = [];
  if (cover < 1.3) questions.push(L_(`承诺每期 $${d.perPeriod.toLocaleString()}，按你申报的利润只有 ${cover.toFixed(2)} 倍覆盖。淡季时用什么钱分红？`, `You promise $${d.perPeriod.toLocaleString()} a period with only ${cover.toFixed(2)}× profit cover. What pays it in a slow season?`));
  if (!has("bank")) questions.push(L_("请上传最近 12 个月的银行流水，证明申报营收。", "Please upload 12 months of bank statements to back the declared revenue."));
  if (!has("license")) questions.push(L_("请上传有效的经营许可证。", "Please upload a valid operating licence."));
  questions.push(L_("融资的钱具体怎么花？请给出预算拆分。", "How exactly will the money be spent? Please share a budget breakdown."));
  questions.push(L_("老板本人的薪酬是多少？运营协议里有没有上限？", "What do you pay yourself, and is it capped in the operating agreement?"));

  const audit: Audit = {
    trustScore,
    grade: gradeOf(trustScore),
    verdict,
    summary:
      verdict === "pass"
        ? L_("主体、身份和线上口碑可以独立核实，现金流足以覆盖承诺分红。", "Entity, identity and reputation check out independently, and cash flow covers the promise.")
        : verdict === "review"
          ? L_("基本信息可核实，但存在需要在公开问答中回答的风险点。", "The basics check out, but there are risks to answer in public Q&A.")
          : L_("关键信息无法核实，暂不能上链。", "Key facts can't be verified, so this can't go on-chain yet."),
    breakdown: { identity, registry, presence, financials, legal },
    metrics: [
      { label: L_("Google 评分", "Google rating"), value: d.mapsUrl ? `${rating} ★ (${reviews})` : "—" },
      { label: L_("Instagram 粉丝", "Instagram followers"), value: d.instagram ? followers.toLocaleString() : "—" },
      { label: L_("月均营收", "Avg monthly revenue"), value: `$${Math.round(d.monthlyRevenue).toLocaleString()}` },
      { label: L_("分红覆盖率", "Dividend cover"), value: `${cover.toFixed(2)}×` },
    ],
    checks,
    flags,
    monitoring: [L_("Google 评分跌破 4.0", "Google rating below 4.0"), L_("月营收下降超过 25%", "Monthly revenue down more than 25%")],
    auditedAt: now(),
    auditHash: fakeHash(d.name + trustScore + now()),
    source: "demo",
  };
  return { audit, questions };
}

// ------------------------------------------------------------------ real agent (slice/agent)

interface AgentReport {
  trustScore: number;
  grade: Audit["grade"];
  verdict: Audit["verdict"];
  summary: string;
  scoreBreakdown: Audit["breakdown"];
  metrics: Record<string, number | string | null>;
  checks: { category: Check["category"]; title: string; status: Check["status"]; finding: string; evidence: { label: string; url: string }[] }[];
  riskFlags: { severity: Severity; title: string; detail: string }[];
  suggestedQuestions: string[];
  monitoring: string[];
}

const same = (s: string): L => ({ zh: s, en: s });

const METRIC_LABELS: Record<string, L> = {
  googleRating: L_("Google 评分", "Google rating"),
  googleReviewCount: L_("Google 评价数", "Google reviews"),
  instagramFollowers: L_("Instagram 粉丝", "Instagram followers"),
  lastSocialPostDays: L_("最近社媒更新（天）", "Days since last post"),
  registryStatus: L_("登记状态", "Registry status"),
  yearsOperating: L_("经营年限", "Years operating"),
  avgMonthlyDeposits: L_("月均存款", "Avg monthly deposits"),
};

export function agentUrl(): string | undefined {
  const url = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? undefined;
  return url ? url.replace(/\/$/, "") : undefined;
}

export async function realAudit(d: Draft, lang: "zh" | "en", onStep: (s: AuditStep, index: number) => void): Promise<AuditResult> {
  const url = agentUrl();
  if (!url) throw new Error("VITE_AGENT_URL is not set");
  const body = {
    business: { name: d.name, category: d.category, description: d.about, country: d.country, city: d.city, website: d.website || undefined, googleMapsUrl: d.mapsUrl || undefined, instagram: d.instagram || undefined, links: [] },
    owner: { fullName: d.ownerName },
    registry: { entityName: d.entityName, jurisdiction: d.jurisdiction },
    financials: { claimedMonthlyRevenue: d.monthlyRevenue },
    offering: { instrument: d.instrument, percentOffered: d.companyPct, targetRaise: d.target, dividendPerPeriod: d.perPeriod, periodDays: d.periodDays },
    reportLanguage: lang,
  };
  const res = await fetch(`${url}/api/audit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`Agent returned ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let index = 0;
  let report: AgentReport | null = null;
  let hash = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const line = chunk.split("\n").find((x) => x.startsWith("data: "));
      if (!line) continue;
      const e = JSON.parse(line.slice(6));
      const step = (icon: StepIcon, title: string, detail: string, status: AuditStep["status"] = "info") => onStep({ icon, title: same(title), detail: same(detail), status }, index++);
      if (e.type === "search") step("search", "Web search", e.query);
      else if (e.type === "fetch") step("search", "Read page", e.url);
      else if (e.type === "tool") step("tool", e.name, JSON.stringify(e.input).slice(0, 160));
      else if (e.type === "thinking") step("think", "Reasoning", e.text.slice(0, 280));
      else if (e.type === "status") step("doc", "Status", e.message);
      else if (e.type === "report") report = e.report;
      else if (e.type === "done") hash = e.auditHash;
      else if (e.type === "error") throw new Error(e.message);
    }
  }
  if (!report) throw new Error("The agent ended without a report");
  const rep: AgentReport = report;
  return {
    audit: {
      trustScore: rep.trustScore,
      grade: rep.grade,
      verdict: rep.verdict,
      summary: same(rep.summary),
      breakdown: rep.scoreBreakdown,
      metrics: Object.entries(rep.metrics)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => ({ label: METRIC_LABELS[k] ?? same(k), value: String(v) })),
      checks: rep.checks.map((c) => ({ ...c, title: same(c.title), finding: same(c.finding) })),
      flags: rep.riskFlags.map((f) => ({ severity: f.severity, title: same(f.title), detail: same(f.detail) })),
      monitoring: rep.monitoring.map(same),
      auditedAt: now(),
      auditHash: hash || fakeHash(JSON.stringify(rep)),
      source: "agent",
    },
    questions: rep.suggestedQuestions.map(same),
  };
}
