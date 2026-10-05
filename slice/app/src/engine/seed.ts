/**
 * Demo world: 13 fictional businesses on five continents, each at a different point in the lifecycle,
 * plus a demo wallet that already holds a few positions so every screen has something real to show.
 * All names, people and numbers here are invented for the demo.
 */
import type {
  Asset,
  Audit,
  Category,
  Check,
  CheckStatus,
  Doc,
  DocKind,
  Draft,
  Instrument,
  L,
  Me,
  PeriodStatus,
  Person,
  Question,
  Rival,
  Severity,
  Stage,
  State,
} from "./types";
import { AI_AGENT, PEOPLE } from "./geo";
import { fakeHash, hashString, mulberry32 } from "../lib/rand";
import { TIME } from "../lib/format";
import { UPFRONT_FEE_BPS, VESTED_FEE_BPS, claimable, clear, emptyPosition, ladder, moveShares, requiredBondPeriods } from "./market";

const DAY = TIME.DAY;
const HOUR = TIME.HOUR;
const L_ = (zh: string, en: string): L => ({ zh, en });
const P = (name: string): Person => PEOPLE.find((p) => p.name === name) ?? PEOPLE[0];

interface QASpec {
  who: string | "ai";
  q: L;
  a?: L;
  hoursAgo: number;
  answeredAfter?: number;
  votes: number;
  doc?: string;
  evasive?: number;
}

interface Spec {
  symbol: string;
  name: string;
  tagline: L;
  about: L;
  terms: L;
  category: Category;
  country: string;
  city: L;
  hue: number;
  owner: { name: string; title: L; since: number };
  entity: string;
  instrument: Instrument;
  companyPct: number;
  stage: Stage;
  ipoPrice: number;
  price: number;
  sharesForSale: number;
  raisedPct?: number;
  ticks?: number; // price ladder steps (auction); omit for fixed price
  tickBps?: number;
  tickBudgets?: number[]; // committed USDT per tick for live rounds
  investors: number;
  ipoDeadlineIn?: number;
  qaEndsIn?: number;
  settlingSinceDays?: number;
  nextDueIn?: number;
  perPeriod: number;
  periodDays: number;
  numPeriods: number;
  reliability: number;
  past?: PeriodStatus[];
  score?: [number, number, number, number, number];
  summary?: L;
  metrics: [L, string | L][];
  presence: L;
  financials: L;
  license?: L;
  extraChecks?: Check[];
  flags: [Severity, L, L][];
  monitoring: L[];
  monthlyBase: number;
  margin: number;
  seasonal?: number[];
  qa: QASpec[];
  docs: [DocKind, L, boolean?][];
  demand: number;
  holders: number;
  vol: number;
}

const REGISTRY: Record<string, L> = {
  US: L_("州务卿商业实体登记", "Secretary of State business registry"),
  JP: L_("国税厅法人番号公表系统", "NTA Corporate Number registry"),
  KR: L_("大法院商业登记 + 音乐著作权协会", "Supreme Court commercial registry + KOMCA"),
  CN: L_("国家企业信用信息公示系统", "National Enterprise Credit Information System"),
  KE: L_("肯尼亚商业登记局（eCitizen）", "Business Registration Service (eCitizen)"),
  PL: L_("波兰国家法院登记（KRS）", "National Court Register (KRS)"),
  AU: L_("澳大利亚 ASIC / ABN 登记", "ASIC / ABN Lookup"),
  BR: L_("巴西联邦税务局 CNPJ 登记", "Receita Federal CNPJ"),
  AE: L_("迪拜经济与旅游局（DET）", "Dubai Department of Economy & Tourism"),
  ID: L_("印尼 OSS 投资登记系统", "Indonesia OSS business licensing"),
  DE: L_("德国商业登记（Handelsregister）", "Handelsregister"),
  TW: L_("经济部商工登记公示资料", "MOEA commercial registration"),
};

function grade(score: number): Audit["grade"] {
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

function stdChecks(s: Spec): Check[] {
  const st = (x: number, max: number): CheckStatus => (x >= max * 0.8 ? "pass" : x >= max * 0.5 ? "warn" : "fail");
  const [id, reg, pres, fin, legal] = s.score ?? [20, 16, 16, 18, 7];
  const checks: Check[] = [
    {
      category: "registry",
      title: L_("工商主体存续", "Legal entity is active"),
      status: st(reg, 20),
      finding: L_(
        `${s.entity} 在${REGISTRY[s.country]?.zh ?? "当地登记机关"}状态为“存续”，成立于 ${s.owner.since} 年，登记地址与申请一致。`,
        `${s.entity} is active in the ${REGISTRY[s.country]?.en ?? "local registry"}, formed ${s.owner.since}; registered address matches the application.`,
      ),
      evidence: [{ label: REGISTRY[s.country]?.en ?? "Registry extract" }],
    },
    {
      category: "identity",
      title: L_("申请人与实际控制人一致", "Applicant controls the business"),
      status: st(id, 25),
      finding: L_(
        `申请人 ${s.owner.name} 是登记在册的${s.owner.title.zh}；证件姓名、银行账户户名、官网与社媒中的署名一致。`,
        `${s.owner.name} is the registered ${s.owner.title.en}; the ID, bank account holder, website and social profiles all match.`,
      ),
      evidence: [{ label: "ID ↔ registry officer list" }, { label: "Bank account holder name" }],
    },
    {
      category: "presence",
      title: L_("线上存在与口碑", "Online presence & reputation"),
      status: st(pres, 20),
      finding: s.presence,
      evidence: s.metrics.slice(0, 2).map(([k, v]) => ({ label: `${k.en}: ${typeof v === "string" ? v : v.en}` })),
    },
    {
      category: "financials",
      title: L_("现金流与承诺分红匹配", "Cash flow covers the promise"),
      status: st(fin, 25),
      finding: s.financials,
      evidence: [{ label: "Bank statements (12 mo)" }, { label: "cashflow_forensics" }],
    },
  ];
  if (s.license) {
    checks.push({
      category: "license",
      title: L_("经营许可", "Operating licences"),
      status: st(legal, 10),
      finding: s.license,
      evidence: [{ label: "Licence registry" }],
    });
  }
  checks.push({
    category: "legal",
    title: L_("诉讼、留置与制裁筛查", "Lawsuits, liens & sanctions"),
    status: st(legal, 10),
    finding:
      legal >= 8
        ? L_("未发现未结诉讼、税务留置或制裁名单命中。", "No open lawsuits, tax liens or sanctions-list hits found.")
        : L_("发现历史小额纠纷记录，已在风险项中列出。", "Minor historical disputes found; listed under risk flags."),
    evidence: [{ label: "Court records search" }, { label: "OFAC / UN sanctions lists" }],
  });
  return [...checks, ...(s.extraChecks ?? [])];
}

function buildAudit(s: Spec, now: number): Audit | null {
  if (!s.score) return null;
  const [identity, registry, presence, financials, legal] = s.score;
  const trustScore = identity + registry + presence + financials + legal;
  const audit: Audit = {
    trustScore,
    grade: grade(trustScore),
    verdict: trustScore >= 70 ? "pass" : trustScore >= 50 ? "review" : "reject",
    summary: s.summary ?? s.tagline,
    breakdown: { identity, registry, presence, financials, legal },
    metrics: s.metrics.map(([label, value]) => ({ label, value })),
    checks: stdChecks(s),
    flags: s.flags.map(([severity, title, detail]) => ({ severity, title, detail })),
    monitoring: s.monitoring,
    auditedAt: now - 20 * DAY,
    auditHash: fakeHash(s.symbol + "audit"),
    source: "demo",
  };
  return audit;
}

function buildQA(s: Spec, now: number): Question[] {
  return s.qa.map((q, i) => ({
    id: `${s.symbol}-q${i}`,
    author: q.who === "ai" ? AI_AGENT : P(q.who),
    ai: q.who === "ai",
    text: q.q,
    at: now - q.hoursAgo * HOUR,
    votes: q.votes,
    evasive: q.evasive ?? 0,
    answer: q.a ? { text: q.a, at: now - q.hoursAgo * HOUR + (q.answeredAfter ?? 6) * HOUR, doc: q.doc } : undefined,
  }));
}

function buildDocs(s: Spec, now: number): Doc[] {
  return s.docs.map(([kind, name, byRequest], i) => ({
    id: `${s.symbol}-d${i}`,
    kind,
    name,
    hash: fakeHash(s.symbol + i),
    at: now - (byRequest ? 3 : 30) * DAY,
    byRequest,
    verified: true,
  }));
}

function buildHistory(s: Spec, listedAt: number, now: number, r: () => number) {
  const days = Math.max(1, Math.round((now - listedAt) / DAY));
  const walk: number[] = [0];
  for (let i = 1; i <= days; i++) walk.push(walk[i - 1] + (r() - 0.5) * s.vol);
  const end = Math.log(s.price / s.ipoPrice);
  const history = walk.map((w, i) => {
    const bridge = w - (walk[days] * i) / days + (end * i) / days;
    return { t: listedAt + i * DAY, p: Math.max(0.05, s.ipoPrice * Math.exp(bridge)) };
  });
  history[history.length - 1] = { t: now, p: s.price };
  const intraday = Array.from({ length: 48 }, (_, i) => ({
    t: now - (47 - i) * 30 * TIME.MIN,
    p: s.price * (1 + (r() - 0.5) * s.vol * 0.25 * ((47 - i) / 47)),
  }));
  intraday[intraday.length - 1] = { t: now, p: s.price };
  return { history, intraday };
}

function buildAsset(s: Spec, now: number): Asset {
  const r = mulberry32(hashString(s.symbol));
  const id = s.symbol.toLowerCase();
  const settleDays = 30;
  const confirmDays = 7;
  const graceDays = 7;
  const minRaise = Math.round(s.sharesForSale * s.ipoPrice * 0.8);

  let opensAt = now - 30 * DAY;
  let deadline = now - 20 * DAY;
  let firstDue: number;
  let listedAt: number | null = null;
  let deliveredAt: number | null = null;
  let settleDeadline: number | null = null;
  let qaEndsAt: number | null = null;
  const past = s.past ?? [];

  if (s.stage === "trading") {
    firstDue = now + (s.nextDueIn ?? 30) * DAY - past.length * s.periodDays * DAY;
    deliveredAt = firstDue - s.periodDays * DAY - 3 * DAY;
    listedAt = deliveredAt;
    deadline = deliveredAt - 12 * DAY;
    opensAt = deadline - 21 * DAY;
    settleDeadline = deadline + settleDays * DAY;
  } else if (s.stage === "settling") {
    deadline = now - (s.settlingSinceDays ?? 6) * DAY;
    opensAt = deadline - 21 * DAY;
    settleDeadline = deadline + settleDays * DAY;
    firstDue = deadline + (settleDays + confirmDays + s.periodDays) * DAY;
  } else if (s.stage === "ipo") {
    deadline = now + (s.ipoDeadlineIn ?? 7) * DAY;
    opensAt = deadline - 21 * DAY;
    firstDue = deadline + (settleDays + confirmDays + s.periodDays) * DAY;
  } else {
    qaEndsAt = s.stage === "qa" ? now + (s.qaEndsIn ?? 3) * DAY : null;
    opensAt = (qaEndsAt ?? now + 10 * DAY) + 0;
    deadline = opensAt + 21 * DAY;
    firstDue = deadline + (settleDays + confirmDays + s.periodDays) * DAY;
  }

  const trading = s.stage === "trading";
  const settling = s.stage === "settling";

  // Price ladder and committed demand. Settled rounds are recorded as exactly filled at the launch price.
  const prices = s.ticks ? ladder(s.ipoPrice, s.tickBps ?? 500, s.ticks) : [s.ipoPrice];
  let tickBudget = prices.map(() => 0);
  if (trading || settling) tickBudget = [s.sharesForSale * s.ipoPrice, ...prices.slice(1).map(() => 0)];
  else if (s.stage === "ipo") tickBudget = s.tickBudgets ?? [Math.round(s.sharesForSale * s.ipoPrice * (s.raisedPct ?? 0))];
  const committed = tickBudget.reduce((x, y) => x + y, 0);
  const clearing = trading || settling ? clear(prices, tickBudget, s.sharesForSale) : null;
  const raised = clearing ? clearing.raised : 0;
  const totalShares = trading ? s.sharesForSale : 0;

  // Bond priced from the AI score; past periods settle the vested fee one slice at a time.
  const score = s.score ? s.score.reduce((x, y) => x + y, 0) : 70;
  const bondPeriods = requiredBondPeriods(score, 0);
  const status: PeriodStatus[] = Array.from({ length: s.numPeriods }, (_, i) => past[i] ?? "pending");
  let bond = s.perPeriod * bondPeriods;
  const vestedTotal = trading ? (raised * VESTED_FEE_BPS) / 10_000 : 0;
  const slice = vestedTotal / s.numPeriods;
  let feeToPlatform = 0;
  let feeToHolders = 0;
  const paid = status.map((st) => {
    if (st === "pending") return 0;
    if (st === "paid") feeToPlatform += slice;
    else feeToHolders += slice;
    if (st === "defaulted") {
      const slashed = Math.min(bond, s.perPeriod);
      bond -= slashed;
      return slashed;
    }
    return s.perPeriod;
  });
  const credit = paid.slice();
  const next = status.indexOf("pending");
  // Revenue routers have been filling the current period since the last due date.
  if (trading && s.instrument === "revenue_share" && next !== -1) {
    const elapsed = 1 - Math.min(1, (s.nextDueIn ?? 30) / s.periodDays);
    credit[next] = Math.round(s.perPeriod * elapsed * (s.reliability > 0.9 ? 1.08 : 0.8));
  }
  const settled = status.filter((x) => x !== "pending").length;
  const distributed = paid.reduce((a, b) => a + b, 0) + feeToHolders + (next !== -1 ? credit[next] : 0);

  const { history, intraday } = trading
    ? buildHistory(s, listedAt!, now, r)
    : { history: [{ t: now - DAY, p: s.ipoPrice }, { t: now, p: s.ipoPrice }], intraday: [] };

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const season = s.seasonal ? s.seasonal[i] : 1;
    return Math.round(s.monthlyBase * season * (0.92 + r() * 0.16));
  });

  const asset: Asset = {
    id,
    symbol: s.symbol,
    name: s.name,
    tagline: s.tagline,
    about: s.about,
    terms: s.terms,
    category: s.category,
    country: s.country,
    city: s.city,
    hue: s.hue,
    owner: s.owner,
    instrument: s.instrument,
    companyPct: s.companyPct,
    stage: s.stage,
    qaEndsAt,
    listedAt,
    offering: {
      prices,
      tickBudget,
      committed,
      price: clearing ? clearing.price : s.ipoPrice,
      sharesForSale: s.sharesForSale,
      minRaise,
      investors: s.investors,
      opensAt,
      deadline,
      clearing,
      settleDeadline,
      agreementHash: trading || settling ? fakeHash(s.symbol + "agreement") : null,
      agreementAt: trading || settling ? (settleDeadline ?? now) - 26 * DAY : null,
      registrationProof: trading ? fakeHash(s.symbol + "registry") : null,
      proofUploadedAt: trading ? deliveredAt! - DAY : null,
      deliveredAt,
      confirmDays,
      settleDays,
      upfrontBps: UPFRONT_FEE_BPS,
      vestedBps: VESTED_FEE_BPS,
      merchantReceived: trading ? raised * (1 - (UPFRONT_FEE_BPS + VESTED_FEE_BPS) / 10_000) : 0,
    },
    commitment: {
      perPeriod: s.perPeriod,
      periodDays: s.periodDays,
      firstDue,
      numPeriods: s.numPeriods,
      graceDays,
      bond,
      bondPeriods,
      status,
      paid,
      credit,
      settled,
      feeRemaining: vestedTotal - settled * slice,
      feeToPlatform,
      feeToHolders,
      reliability: s.reliability,
    },
    router: s.instrument === "revenue_share" ? { holderBps: s.companyPct * 100, toHolders: distributed, toMerchant: (distributed * (100 - s.companyPct)) / s.companyPct } : null,
    audit: buildAudit(s, now),
    qa: buildQA(s, now),
    docs: buildDocs(s, now),
    totalShares,
    price: trading ? s.price : s.ipoPrice,
    history,
    intraday,
    dps: totalShares > 0 ? distributed / totalShares : 0,
    distributed,
    holders: s.holders,
    monthly,
    margin: s.margin,
    volume24h: trading ? Math.round(s.sharesForSale * s.price * (0.004 + r() * 0.012)) : 0,
    markets: [],
    demand: s.demand,
  };

  // A confidence market on the next payout of every live commitment.
  if (trading || s.stage === "ipo" || settling) {
    if (next !== -1) {
      const pool = 800 + r() * 6000;
      const belief = Math.min(0.97, Math.max(0.08, s.reliability + (r() - 0.5) * 0.08));
      asset.markets.push({ period: next, yes: pool * belief, no: pool * (1 - belief), myYes: 0, myNo: 0, resolved: null, claimed: false });
    }
  }
  return asset;
}

// -------------------------------------------------------------------------------------------- the world

const QUARTER = 91;
const MONTH = 30;

const SPECS: Spec[] = [
  {
    symbol: "NCB",
    name: "Neon Coyote Bar",
    tagline: L_("洛杉矶 Echo Park 的现场音乐鸡尾酒吧，出让 30% 股权", "Live-music cocktail bar in Echo Park, LA — 30% equity"),
    about: L_(
      "85 个座位，每周五晚有现场乐队，开业 6 年。老板出让 30% 股权给全球投资人，融资用于扩建露台（预计新增 30 个座位）。营收数据来自 Square POS 只读直连与 12 个月银行流水。",
      "85 seats, live bands every Friday, open for six years. The owner is selling 30% to investors worldwide to fund a patio expansion (≈30 more seats). Revenue comes from a read-only Square POS feed and 12 months of bank statements.",
    ),
    terms: L_("30% 股权 · 每季度保底分红 $9,000 · 保证金 1 个季度", "30% equity · $9,000 minimum quarterly dividend · 1-quarter bond"),
    category: "bar",
    country: "US",
    city: L_("洛杉矶", "Los Angeles"),
    hue: 14,
    owner: { name: "Marcus Delgado", title: L_("管理成员", "managing member"), since: 2020 },
    entity: "Neon Coyote Bar LLC",
    instrument: "equity",
    companyPct: 30,
    stage: "ipo",
    ipoPrice: 1,
    price: 1,
    sharesForSale: 300_000,
    ticks: 6, // investors name their price: $1.00 → $1.28 in +5% steps
    tickBps: 500,
    tickBudgets: [60_000, 150_000, 95_000, 60_000, 20_000, 10_000],
    investors: 412,
    ipoDeadlineIn: 5,
    perPeriod: 9_000,
    periodDays: QUARTER,
    numPeriods: 8,
    reliability: 0.9,
    score: [23, 19, 18, 19, 7],
    summary: L_(
      "主体、老板身份与线上口碑均可独立核实；12 个月存款稳定，承诺分红约占估算净利润的 70%。主要风险是现金收入占比和租约续期。",
      "Entity, owner identity and reputation all check out independently. Deposits are steady for 12 months and the promised dividend is about 70% of estimated profit. Main risks: cash share of revenue and the lease renewal.",
    ),
    metrics: [
      [L_("Google 评分", "Google rating"), "4.6 ★ (1,284)"],
      [L_("Instagram 粉丝", "Instagram followers"), "12.4K"],
      [L_("月均存款", "Avg monthly deposits"), "$98,700"],
      [L_("经营年限", "Years operating"), "6"],
      [L_("最近一次社媒更新", "Last social post"), L_("2 天前", "2 days ago")],
    ],
    presence: L_(
      "Google 地图 4.6 星、1,284 条评价，近 30 天有 41 条新评价且分布自然；Instagram @neoncoyote 每周更新，地点标签与地址一致；Yelp 4.5 星。",
      "4.6★ on Google Maps with 1,284 reviews, 41 in the last 30 days with a natural spread; Instagram posts weekly with matching location tags; 4.5★ on Yelp.",
    ),
    financials: L_(
      "12 个月存款均值 $98,700，波动系数 0.08；12 月高出均值 14%（已由包场合同解释）。按酒吧行业 12–15% 净利率估算，年净利 $14–18 万，30% 对应 $4.2–5.3 万，承诺的 $3.6 万/年覆盖率约 1.3 倍。",
      "Deposits average $98,700 a month with a coefficient of variation of 0.08; December ran 14% above average (explained by private-event contracts). At 12–15% bar margins, yearly profit is $140–180K; 30% of that is $42–53K, so the $36K/yr promise is covered about 1.3×.",
    ),
    license: L_(
      "加州 ABC 47 类酒牌有效至 2027 年 6 月。股权变更超过 10% 需向 ABC 报备，平台已将报备回执列为交割条件。",
      "California ABC Type 47 licence valid to June 2027. Ownership changes above 10% must be reported to ABC; the filing receipt is a settlement condition.",
    ),
    flags: [
      ["medium", L_("现金收入约占 22%", "≈22% of revenue is cash"), L_("POS 只覆盖刷卡；现金部分依赖老板申报，已要求每日现金日报拍照上传。", "The POS feed covers cards only; cash relies on the owner's reports. Daily cash-count photos are now required.")],
      ["low", L_("租约 2029 年到期", "Lease ends 2029"), L_("续租条款中的涨租上限尚未提供，问答区已有人追问。", "The rent-increase cap on renewal hasn't been provided yet; asked in Q&A.")],
      ["low", L_("关键人风险", "Key-person risk"), L_("老板本人负责选酒与乐队排期。", "The owner personally runs the drinks list and band bookings.")],
    ],
    monitoring: [
      L_("Google 评分跌破 4.3", "Google rating drops below 4.3"),
      L_("连续 2 个月 POS 营业额下降超过 20%", "POS revenue down more than 20% for two straight months"),
      L_("ABC 酒牌状态变化", "Any change to the ABC licence status"),
    ],
    monthlyBase: 98_000,
    margin: 0.13,
    seasonal: [0.92, 0.9, 0.95, 0.98, 1.02, 1.05, 1.08, 1.06, 1.0, 0.98, 1.0, 1.14],
    qa: [
      {
        who: "ai",
        q: L_("2025 年 12 月存款 $112,300，比 12 个月均值高 14%。这笔增量来自哪里？", "December 2025 deposits were $112,300, 14% above the 12-month average. Where did the extra come from?"),
        a: L_("12 月有 9 场私人包场（公司圣诞派对）。包场合同和 Square 订单导出已上传到文件区。", "Nine private buyouts in December (company holiday parties). The contracts and the Square export are in Documents."),
        hoursAgo: 70,
        answeredAfter: 5,
        votes: 37,
        doc: "Private event contracts, Dec 2025",
      },
      {
        who: "Kenji",
        q: L_("每季度 $9,000 从哪部分利润出？淡季利润不够怎么办？", "Which profit pays the $9,000 a quarter? What happens in a slow quarter?"),
        a: L_("过去 4 个季度净利润在 $3.8 万–$5.2 万之间，30% 对应 $1.1 万–$1.6 万，$9,000 是保守值。另外合约里锁了 $9,000 保证金，就算我没付，也会自动赔付给大家。", "Net profit was $38K–52K in each of the last four quarters; 30% of that is $11K–16K, so $9,000 is conservative. There is also a $9,000 bond locked in the contract: if I don't pay, it pays you automatically."),
        hoursAgo: 52,
        answeredAfter: 3,
        votes: 58,
      },
      {
        who: "Ada",
        q: L_("老板是否在其他酒吧或供应商有股份？有没有关联交易？", "Do you own stakes in other bars or suppliers? Any related-party deals?"),
        a: L_("我持有 Silver Lake 一家咖啡店 20% 股份，跟本店没有供货关系。运营协议写明：超过 $5,000/年的关联交易需要持有人投票。", "I own 20% of a café in Silver Lake that doesn't supply the bar. The operating agreement requires a holder vote for any related-party deal over $5,000 a year."),
        hoursAgo: 30,
        answeredAfter: 9,
        votes: 21,
      },
      {
        who: "Lena",
        q: L_("租约 2029 年到期，续租时租金上涨上限是多少？能上传租约吗？", "The lease ends in 2029. What's the cap on rent increases at renewal? Can you upload the lease?"),
        hoursAgo: 2,
        votes: 14,
      },
    ],
    docs: [
      ["registry", L_("公司章程（加州州务卿）", "Articles of Organization (CA SOS)")],
      ["registry", L_("2026 年度信息声明", "Statement of Information 2026")],
      ["id", L_("管理成员身份证件", "Managing member photo ID")],
      ["bank", L_("银行流水 12 个月", "Bank statements, 12 months")],
      ["pos", L_("Square POS 只读授权", "Square POS read-only grant")],
      ["tax", L_("2025 年合伙企业报税表 1065", "2025 partnership return (Form 1065)")],
      ["license", L_("加州 ABC 47 类酒牌", "California ABC Type 47 licence")],
      ["lease", L_("店面租赁合同（摘要）", "Premises lease (summary)")],
      ["other", L_("2025 年 12 月包场合同", "Private event contracts, Dec 2025"), true],
    ],
    demand: 1.15,
    holders: 412,
    vol: 0.03,
  },
  {
    symbol: "RAIN",
    name: "Midnight Rain — HAEUN",
    tagline: L_("首尔独立歌手的单曲母带版税，50% 分给持有人 5 年", "A Seoul indie single's master royalties — 50% to holders for 5 years"),
    about: L_(
      "《Midnight Rain》2024 年发行，月均播放约 90 万次。发行商 DistroKid 的收款人已改为 Slice 的 SPV 账户，版税在源头直接进入合约分配，歌手本人碰不到这笔钱。",
      "Released in 2024, about 900K streams a month. The DistroKid payee is now Slice's SPV account, so royalties flow straight into the contract at the source; the artist never touches the money.",
    ),
    terms: L_("母带版税 50% · 每月分配 · 保底 $1,400/月 · 5 年", "50% of master royalties · paid monthly · $1,400/month floor · 5 years"),
    category: "music",
    country: "KR",
    city: L_("首尔", "Seoul"),
    hue: 262,
    owner: { name: "Han Ha-eun (HAEUN)", title: L_("词曲作者兼母带所有人", "songwriter and master owner"), since: 2021 },
    entity: "HAEUN Music",
    instrument: "revenue_share",
    companyPct: 50,
    stage: "trading",
    ipoPrice: 1,
    price: 1.27,
    sharesForSale: 120_000,
    investors: 1_206,
    nextDueIn: 9,
    perPeriod: 1_400,
    periodDays: MONTH,
    numPeriods: 60,
    reliability: 0.98,
    past: ["paid", "paid", "paid", "paid", "paid", "paid", "paid"],
    score: [23, 18, 19, 23, 8],
    summary: L_(
      "钱由发行商直接打到 SPV，属于结构性免信任资产；播放数据可通过 Spotify for Artists 只读授权实时核对。主要风险是单曲收入随时间衰减。",
      "Royalties go from the distributor straight to the SPV, so trust is structural. Streams can be checked live through a read-only Spotify for Artists grant. The main risk is a single song's natural decay.",
    ),
    metrics: [
      [L_("Spotify 月听众", "Spotify monthly listeners"), "1.3M"],
      [L_("月播放量", "Monthly streams"), "≈900K"],
      [L_("收款路径", "Payment path"), "DistroKid → SPV"],
      [L_("已按时分配", "Paid on time"), "7 / 7"],
    ],
    presence: L_(
      "Spotify 月听众 130 万，2025 年 9 月被收录进官方歌单后播放量翻倍；YouTube 官方 MV 210 万播放；Instagram 4.8 万粉丝，互动率正常。",
      "1.3M monthly listeners on Spotify; streams doubled after an official playlist add in September 2025. 2.1M views on the official video; 48K Instagram followers with normal engagement.",
    ),
    financials: L_(
      "过去 18 个月版税对账单与 DistroKid 后台一致；月均母带收入约 $3,150，50% 对应 $1,575，保底 $1,400 覆盖率 1.1 倍。",
      "18 months of royalty statements match the DistroKid dashboard. Master income averages about $3,150 a month; 50% is $1,575, covering the $1,400 floor 1.1×.",
    ),
    flags: [
      ["medium", L_("单曲依赖", "Single-song concentration"), L_("全部收入来自一首歌；流媒体收入通常每年衰减 20–40%。", "All income comes from one song; streaming income typically decays 20–40% a year.")],
      ["low", L_("汇兑损耗", "FX leakage"), L_("约 30% 的版税以韩元结算，换成 USDT 有约 0.6% 损耗。", "About 30% of royalties settle in KRW; converting to USDT costs about 0.6%.")],
    ],
    monitoring: [L_("月播放量跌破 50 万", "Monthly streams fall below 500K"), L_("发行商收款人变更", "Any change of distributor payee")],
    monthlyBase: 3_150,
    margin: 1,
    qa: [
      {
        who: "Lucas",
        q: L_("版税是先进你的账户，还是直接进 SPV？", "Do royalties hit your account first, or go straight to the SPV?"),
        a: L_("DistroKid 的收款人已改成 Slice 的 SPV 账户，我碰不到这笔钱。变更截图和 DistroKid 的确认邮件都在文件区。", "The DistroKid payee is now Slice's SPV account; I can't touch the money. The change screenshot and DistroKid's confirmation email are in Documents."),
        hoursAgo: 400,
        votes: 88,
        doc: "DistroKid payee change confirmation",
      },
      {
        who: "ai",
        q: L_("播放量在 2025 年 9 月翻倍，是否有付费推广或刷量？", "Streams doubled in September 2025. Any paid promotion or botting?"),
        a: L_("那个月被 Spotify 官方歌单《Late Night Korea》收录，没有付费推广。歌单收录记录已上传。", "The song was added to Spotify's official 'Late Night Korea' playlist that month; no paid promotion. The playlist record is uploaded."),
        hoursAgo: 380,
        votes: 45,
      },
    ],
    docs: [
      ["registry", L_("个人事业者登记证", "Sole-proprietor registration")],
      ["royalty", L_("DistroKid 收款人变更确认", "DistroKid payee change confirmation")],
      ["royalty", L_("18 个月版税对账单", "18 months of royalty statements")],
      ["agreement", L_("母带权益转让协议", "Master-rights assignment agreement")],
      ["id", L_("身份证件", "Photo ID")],
    ],
    demand: 1.1,
    holders: 1_206,
    vol: 0.035,
  },
  {
    symbol: "KAZE",
    name: "Menya Kaze",
    tagline: L_("大阪难波排队拉面店，出让 20% 股权", "Queue-out-the-door ramen in Namba, Osaka — 20% equity"),
    about: L_(
      "鸡白汤拉面，18 个座位，日均翻台 11 次。Tabelog 3.58，连续三年入选“百名店”。融资用于在梅田开第二家店。",
      "Chicken paitan ramen, 18 seats, about 11 turns a day. Tabelog 3.58 and a 'Hyakumeiten' top-100 pick three years running. Raising to open a second shop in Umeda.",
    ),
    terms: L_("20% 股权 · 每季度分红 $7,200 · 3 年", "20% equity · $7,200 quarterly dividend · 3 years"),
    category: "restaurant",
    country: "JP",
    city: L_("大阪", "Osaka"),
    hue: 352,
    owner: { name: "Kazuya Mori (森 和也)", title: L_("代表董事", "representative director"), since: 2017 },
    entity: "株式会社麺屋風",
    instrument: "equity",
    companyPct: 20,
    stage: "trading",
    ipoPrice: 1.5,
    price: 2.06,
    sharesForSale: 200_000,
    investors: 2_018,
    nextDueIn: 24,
    perPeriod: 7_200,
    periodDays: QUARTER,
    numPeriods: 12,
    reliability: 0.95,
    past: ["paid", "paid", "paid", "paid", "paid"],
    score: [24, 19, 19, 20, 6],
    metrics: [
      [L_("Google 评分", "Google rating"), "4.5 ★ (2,960)"],
      [L_("Tabelog", "Tabelog"), "3.58"],
      [L_("日均客数", "Covers per day"), "≈200"],
      [L_("已按时分红", "Paid on time"), "5 / 5"],
    ],
    presence: L_(
      "Google 4.5 星、2,960 条评价；Tabelog 3.58 并连续入选百名店；店门口排队照片在 Instagram 上按地点标签可查到 3,000+ 条。",
      "4.5★ with 2,960 Google reviews; Tabelog 3.58 and a Hyakumeiten pick; 3,000+ location-tagged Instagram posts of the queue.",
    ),
    financials: L_("POS（Airレジ）数据与银行入账一致，月营收约 ¥1,350 万，净利率约 16%。", "POS (Airレジ) data matches bank deposits; monthly revenue about ¥13.5M at roughly 16% net margin."),
    license: L_("饮食店营业许可（大阪市保健所）有效。", "Restaurant licence from the Osaka City public health office is valid."),
    flags: [
      ["low", L_("主厨即老板", "Chef is the owner"), L_("汤头配方由老板掌握，第二家店的出品稳定性待验证。", "The owner holds the broth recipe; consistency at the second shop is unproven.")],
      ["medium", L_("日元汇率", "Yen exposure"), L_("营收以日元计，日元走弱会降低 USDT 分红的实际价值。", "Revenue is in yen; a weaker yen lowers the USDT value of profits.")],
    ],
    monitoring: [L_("Tabelog 评分跌破 3.5", "Tabelog falls below 3.5"), L_("二号店开业延期超过 3 个月", "Second shop delayed more than 3 months")],
    monthlyBase: 90_000,
    margin: 0.16,
    qa: [
      {
        who: "Minjun",
        q: L_("二号店开业后，一号店的分红会被摊薄吗？", "Will the first shop's dividend get diluted once the second opens?"),
        a: L_("不会。股东协议规定分红按两家店合并利润计算，二号店头 6 个月的亏损由我个人承担。", "No. The shareholder agreement computes dividends on combined profit, and I personally cover the second shop's losses for its first six months."),
        hoursAgo: 900,
        votes: 66,
      },
    ],
    docs: [
      ["registry", L_("履历事项全部证明书", "Certificate of registered matters")],
      ["pos", L_("Airレジ 只读授权", "Airレジ read-only grant")],
      ["bank", L_("银行流水 12 个月", "Bank statements, 12 months")],
      ["license", L_("饮食店营业许可", "Restaurant licence")],
    ],
    demand: 1.2,
    holders: 2_018,
    vol: 0.028,
  },
  {
    symbol: "GLOW",
    name: "Lumi Botanics",
    tagline: L_("深圳出海护肤品牌，Shopify 月 GMV 8% 分给持有人", "Shenzhen DTC skincare on Shopify — 8% of monthly GMV to holders"),
    about: L_(
      "主打北美市场的植物护肤品牌，Shopify 独立站 + TikTok Shop。Stripe 与 Shopify 数据只读直连，GMV 实时可见。",
      "Plant-based skincare selling mainly to North America through Shopify and TikTok Shop. Stripe and Shopify feeds are connected read-only, so GMV is visible live.",
    ),
    terms: L_("月 GMV 的 8% · 每月分配 · 保底 $2,000 · 3 年", "8% of monthly GMV · paid monthly · $2,000 floor · 3 years"),
    category: "ecommerce",
    country: "CN",
    city: L_("深圳", "Shenzhen"),
    hue: 168,
    owner: { name: "林晓 Lin Xiao", title: L_("执行董事", "executive director"), since: 2021 },
    entity: "深圳市露米植物科技有限公司",
    instrument: "revenue_share",
    companyPct: 8,
    stage: "trading",
    ipoPrice: 1,
    price: 0.94,
    sharesForSale: 250_000,
    investors: 1_544,
    nextDueIn: 4,
    perPeriod: 2_000,
    periodDays: MONTH,
    numPeriods: 36,
    reliability: 0.93,
    past: ["paid", "paid", "paid", "paid", "late", "paid", "paid", "paid", "paid"],
    score: [21, 17, 16, 18, 7],
    metrics: [
      [L_("月 GMV（Stripe）", "Monthly GMV (Stripe)"), "$41,200"],
      [L_("退货率", "Return rate"), "6.8%"],
      [L_("Trustpilot", "Trustpilot"), "4.2 ★ (860)"],
      [L_("按时分配", "Paid on time"), "8 / 9"],
    ],
    presence: L_("Shopify 独立站流量稳定，Trustpilot 4.2 星 860 条评价，TikTok 账号 22 万粉丝。", "Steady Shopify traffic, 4.2★ on Trustpilot from 860 reviews, 220K TikTok followers."),
    financials: L_("Stripe 显示近 12 个月 GMV 月均 $4.1 万，8% 约 $3,300，高于保底 $2,000。", "Stripe shows about $41K monthly GMV over 12 months; 8% is about $3,300, above the $2,000 floor."),
    flags: [
      ["medium", L_("广告依赖", "Ad dependence"), L_("Meta 与 TikTok 广告支出占营收 31%，广告成本上升会挤压现金流。", "Meta and TikTok ads are 31% of revenue; rising ad costs would squeeze cash flow.")],
      ["medium", L_("一次逾期", "One late payment"), L_("第 5 期晚了 4 天（Stripe 回款延迟），已记入链上履约记录。", "Period 5 was 4 days late (Stripe payout delay); it's recorded on-chain.")],
      ["low", L_("退货率 6.8%", "6.8% return rate"), L_("略高于品类均值 5%。", "Slightly above the 5% category average.")],
    ],
    monitoring: [L_("Stripe 月 GMV 低于 $2.5 万", "Stripe monthly GMV below $25K"), L_("Shopify 店铺状态变化", "Shopify store status change")],
    monthlyBase: 41_200,
    margin: 0.18,
    qa: [
      {
        who: "Tyler",
        q: L_("第 5 期为什么晚了？以后怎么避免？", "Why was period 5 late, and how will you prevent it?"),
        a: L_("Stripe 那个月因为风控复核延迟了 4 天打款。之后我们在合约里多存了一个月的保底金额作为缓冲。", "Stripe held payouts 4 days for a risk review that month. We've since topped up the bond by an extra month as a buffer."),
        hoursAgo: 600,
        votes: 31,
      },
    ],
    docs: [
      ["registry", L_("营业执照", "Business licence")],
      ["pos", L_("Stripe 只读授权", "Stripe read-only grant")],
      ["pos", L_("Shopify 只读授权", "Shopify read-only grant")],
      ["agreement", L_("收入分成协议", "Revenue-share agreement")],
    ],
    demand: 0.9,
    holders: 1_544,
    vol: 0.04,
  },
  {
    symbol: "SUNK",
    name: "Kisumu Solar Mini-Grid",
    tagline: L_("肯尼亚湖区 1,240 户的太阳能微电网，电费收入分成", "Solar mini-grid serving 1,240 homes by Lake Victoria — tariff revenue share"),
    about: L_(
      "预付费智能电表 + M-Pesa 缴费，回款率 96%。电费由 M-Pesa 直接进入托管账户，运营方碰不到钱。",
      "Prepaid smart meters paid through M-Pesa with a 96% collection rate. Tariffs flow from M-Pesa straight into an escrow account the operator can't touch.",
    ),
    terms: L_("电费收入 60% · 每月分配 · 保底 $1,900 · 7 年", "60% of tariff revenue · paid monthly · $1,900 floor · 7 years"),
    category: "energy",
    country: "KE",
    city: L_("基苏木", "Kisumu"),
    hue: 46,
    owner: { name: "Grace Achieng", title: L_("董事", "director"), since: 2019 },
    entity: "Lakeside Power Ltd",
    instrument: "revenue_share",
    companyPct: 60,
    stage: "trading",
    ipoPrice: 1,
    price: 1.09,
    sharesForSale: 180_000,
    investors: 980,
    nextDueIn: 12,
    perPeriod: 1_900,
    periodDays: MONTH,
    numPeriods: 84,
    reliability: 0.96,
    past: ["paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid", "paid"],
    score: [22, 18, 16, 21, 7],
    metrics: [
      [L_("接入户数", "Connections"), "1,240"],
      [L_("回款率", "Collection rate"), "96%"],
      [L_("月电费收入", "Monthly tariff revenue"), "$3,600"],
      [L_("按时分配", "Paid on time"), "11 / 11"],
    ],
    presence: L_("肯尼亚能源与石油监管局（EPRA）许可可查；当地媒体两次报道；设备供应商确认安装容量 180 kWp。", "EPRA licence verified; covered twice by local press; the equipment vendor confirmed 180 kWp installed."),
    financials: L_("智能电表平台数据与 M-Pesa 对账一致，月收入约 $3,600，60% 对应 $2,160。", "Meter-platform data reconciles with M-Pesa; about $3,600 a month, 60% of which is $2,160."),
    license: L_("EPRA 微电网发电与售电许可有效至 2031 年。", "EPRA mini-grid generation and retail licence valid to 2031."),
    flags: [
      ["medium", L_("先令汇率", "Shilling exposure"), L_("收入以肯尼亚先令计，换成 USDT 前有汇率风险。", "Revenue is in shillings; FX risk until converted to USDT.")],
      ["low", L_("设备保险", "Equipment insurance"), L_("保险覆盖至 2029 年，之后需续保。", "Insurance runs to 2029 and must be renewed.")],
    ],
    monitoring: [L_("回款率低于 90%", "Collection rate below 90%"), L_("EPRA 许可状态", "EPRA licence status")],
    monthlyBase: 3_600,
    margin: 0.7,
    qa: [
      {
        who: "Priya",
        q: L_("如果主电网接到村里，微电网会不会没人用？", "If the national grid reaches the village, will anyone still use the mini-grid?"),
        a: L_("EPRA 规则下我们可以把电网资产以评估价出售给 KPLC，所得优先偿还持有人剩余收益。", "Under EPRA rules we can sell the assets to KPLC at appraised value; proceeds repay holders first."),
        hoursAgo: 1200,
        votes: 52,
      },
    ],
    docs: [
      ["registry", L_("公司注册证书", "Certificate of incorporation")],
      ["license", L_("EPRA 许可", "EPRA licence")],
      ["pos", L_("智能电表平台只读授权", "Metering platform read-only grant")],
    ],
    demand: 0.85,
    holders: 980,
    vol: 0.02,
  },
  {
    symbol: "PIXL",
    name: "Pixel Odyssey",
    tagline: L_("克拉科夫独立游戏，Steam 净收入 20% 分 4 年", "Indie game from Kraków — 20% of Steam net revenue for 4 years"),
    about: L_("像素风 Roguelike，Steam 好评率 94%，售价 $14.99。Steam 结算报表通过只读 API 拉取。", "Pixel-art roguelike, 94% positive on Steam at $14.99. Steam settlement reports come in through a read-only API."),
    terms: L_("Steam 净收入 20% · 每季度 · 保底 $4,500 · 4 年", "20% of Steam net revenue · quarterly · $4,500 floor · 4 years"),
    category: "game",
    country: "PL",
    city: L_("克拉科夫", "Kraków"),
    hue: 300,
    owner: { name: "Tomasz Nowicki", title: L_("董事会成员", "management board member"), since: 2022 },
    entity: "Odyssey Pixel sp. z o.o.",
    instrument: "revenue_share",
    companyPct: 20,
    stage: "trading",
    ipoPrice: 1,
    price: 0.71,
    sharesForSale: 150_000,
    investors: 870,
    nextDueIn: 40,
    perPeriod: 4_500,
    periodDays: QUARTER,
    numPeriods: 16,
    reliability: 0.82,
    past: ["paid", "paid", "paid"],
    score: [22, 17, 17, 17, 8],
    metrics: [
      [L_("Steam 评价", "Steam reviews"), "94% (3,412)"],
      [L_("同时在线峰值", "Peak concurrent"), "1,980"],
      [L_("季度净收入", "Quarterly net revenue"), "$26,100"],
    ],
    presence: L_("Steam 好评 94%，SteamDB 显示首发后在线人数正常衰减，无刷评迹象。", "94% positive on Steam; SteamDB shows normal post-launch decay and no review manipulation."),
    financials: L_("Steam 季度净收入从首发的 $6.8 万降到 $2.6 万，20% 为 $5,200，仍覆盖保底。", "Quarterly Steam net revenue fell from $68K at launch to $26K; 20% is $5,200, still above the floor."),
    flags: [
      ["medium", L_("收入快速衰减", "Fast revenue decay"), L_("独立游戏第二年收入通常下降 50–70%，价格已反映这一点。", "Indie games usually lose 50–70% of revenue in year two; the price reflects it.")],
      ["low", L_("主机版未定", "Console port uncertain"), L_("Switch 版本延期至 2027 年。", "The Switch version slipped to 2027.")],
    ],
    monitoring: [L_("季度净收入低于 $2.25 万", "Quarterly net revenue below $22.5K")],
    monthlyBase: 8_700,
    margin: 0.9,
    qa: [
      {
        who: "Kasia",
        q: L_("Switch 版本的收入算不算在分成里？", "Does Switch revenue count toward the share?"),
        a: L_("算。分成协议覆盖所有平台的净收入，Switch 上线后同样按 20% 分。", "Yes. The agreement covers net revenue on every platform; Switch will pay 20% too."),
        hoursAgo: 300,
        votes: 19,
      },
    ],
    docs: [
      ["registry", L_("KRS 登记摘录", "KRS registry extract")],
      ["royalty", L_("Steam 结算 API 只读授权", "Steam settlement API read-only grant")],
      ["agreement", L_("收入分成协议", "Revenue-share agreement")],
    ],
    demand: 0.7,
    holders: 870,
    vol: 0.05,
  },
  {
    symbol: "ROAST",
    ticks: 5,
    tickBps: 500,
    name: "Southbank Roasters",
    tagline: L_("墨尔本精品咖啡烘焙 + 两家门店，出让 25% 股权", "Melbourne specialty roaster with two cafés — 25% equity"),
    about: L_(
      "自家烘焙供应 40 家咖啡馆，两家直营门店。正在公开问答期：任何人都可以提问，老板必须在 72 小时内回答。",
      "Roasts for 40 wholesale cafés and runs two of its own. Now in the public Q&A window: anyone can ask, and the owner must answer within 72 hours.",
    ),
    terms: L_("25% 股权 · 每季度分红 $6,600 · 保证金 1 个季度", "25% equity · $6,600 quarterly dividend · 1-quarter bond"),
    category: "cafe",
    country: "AU",
    city: L_("墨尔本", "Melbourne"),
    hue: 28,
    owner: { name: "Sophie Tran", title: L_("董事", "director"), since: 2018 },
    entity: "Southbank Roasters Pty Ltd",
    instrument: "equity",
    companyPct: 25,
    stage: "qa",
    ipoPrice: 1,
    price: 1,
    sharesForSale: 220_000,
    investors: 0,
    qaEndsIn: 3,
    perPeriod: 6_600,
    periodDays: QUARTER,
    numPeriods: 8,
    reliability: 0.92,
    score: [21, 18, 17, 15, 6],
    metrics: [
      [L_("Google 评分", "Google rating"), "4.7 ★ (1,050)"],
      [L_("批发客户", "Wholesale accounts"), "40"],
      [L_("月均存款", "Avg monthly deposits"), "$132,000"],
    ],
    presence: L_("两家门店 Google 均 4.7 星；批发客户名单中抽查 5 家，均确认在用其咖啡豆。", "Both cafés are 4.7★ on Google; 5 of 40 wholesale clients were spot-checked and confirmed."),
    financials: L_("存款波动系数 0.19，偏高；批发回款周期 45 天。承诺分红覆盖率约 1.15 倍。", "Deposit volatility (CV 0.19) is on the high side; wholesale receivables run 45 days. Dividend cover is about 1.15×."),
    flags: [
      ["medium", L_("生豆价格", "Green-bean prices"), L_("阿拉比卡期货一年上涨 38%，毛利率承压。", "Arabica futures are up 38% in a year, squeezing margins.")],
      ["medium", L_("覆盖率偏低", "Thin cover"), L_("承诺分红只有 1.15 倍利润覆盖。", "The promised dividend is covered only 1.15× by profit.")],
    ],
    monitoring: [L_("批发客户少于 30 家", "Fewer than 30 wholesale accounts")],
    monthlyBase: 132_000,
    margin: 0.09,
    qa: [
      {
        who: "ai",
        q: L_("阿拉比卡期货一年涨了 38%，你们的生豆采购合同锁价到什么时候？", "Arabica futures rose 38% in a year. How far ahead are your green-bean contracts priced?"),
        a: L_("我们和两家进口商签了锁价合同到 2027 年 3 月，覆盖约 70% 用量。合同已上传。", "We have fixed-price contracts with two importers through March 2027, covering about 70% of volume. Uploaded."),
        hoursAgo: 40,
        votes: 27,
        doc: "Green-bean forward contracts",
      },
      {
        who: "ai",
        q: L_("批发应收账款平均 45 天回款，有没有超过 90 天的坏账？", "Wholesale receivables average 45 days. Any bad debt over 90 days?"),
        hoursAgo: 40,
        votes: 22,
      },
      {
        who: "Olivia",
        q: L_("两家店的租约分别什么时候到期？", "When do the two café leases end?"),
        a: L_("南岸店 2030 年，Fitzroy 店 2028 年，均有 5 年续租选择权。", "Southbank in 2030 and Fitzroy in 2028, both with a five-year renewal option."),
        hoursAgo: 20,
        votes: 9,
      },
      {
        who: "Wei Ling",
        q: L_("老板个人每年领多少工资？会不会用工资吃掉利润？", "How much salary do you take? Could salary eat the profit?"),
        hoursAgo: 6,
        votes: 18,
      },
    ],
    docs: [
      ["registry", L_("ASIC 公司摘要", "ASIC company extract")],
      ["bank", L_("银行流水 12 个月", "Bank statements, 12 months")],
      ["pos", L_("Square POS 只读授权", "Square POS read-only grant")],
      ["other", L_("生豆远期合同", "Green-bean forward contracts"), true],
    ],
    demand: 1,
    holders: 0,
    vol: 0.03,
  },
  {
    symbol: "VLOG",
    name: "Rua Sabor",
    tagline: L_("圣保罗街头美食 YouTube 频道，广告 + 赞助收入 30%", "São Paulo street-food YouTube channel — 30% of ads and sponsorships"),
    about: L_("每周 2 期，频道 86 万订阅。AdSense 收入通过 YouTube Studio 只读授权核对，赞助合同逐份上传。", "Two episodes a week, 860K subscribers. AdSense income is verified through a read-only YouTube Studio grant; each sponsorship contract is uploaded."),
    terms: L_("广告 + 赞助收入 30% · 每月 · 保底 $1,100 · 3 年", "30% of ads + sponsorships · monthly · $1,100 floor · 3 years"),
    category: "creator",
    country: "BR",
    city: L_("圣保罗", "São Paulo"),
    hue: 120,
    owner: { name: "Rafael Costa", title: L_("创作者兼公司唯一股东", "creator and sole shareholder"), since: 2020 },
    entity: "Rua Sabor Produções Ltda",
    instrument: "revenue_share",
    companyPct: 30,
    stage: "trading",
    ipoPrice: 1,
    price: 1.12,
    sharesForSale: 90_000,
    investors: 2_610,
    nextDueIn: 17,
    perPeriod: 1_100,
    periodDays: MONTH,
    numPeriods: 36,
    reliability: 0.9,
    past: ["paid", "paid", "paid", "paid", "paid", "paid"],
    score: [20, 16, 18, 13, 6],
    metrics: [
      [L_("YouTube 订阅", "YouTube subscribers"), "860K"],
      [L_("月观看", "Monthly views"), "6.1M"],
      [L_("月收入", "Monthly income"), "$4,300"],
    ],
    presence: L_("频道 86 万订阅、近 90 天观看稳定；评论区互动真实，无买量迹象。", "860K subscribers with steady 90-day views; genuine comment activity, no sign of bought views."),
    financials: L_("AdSense 月均 $2,600 + 赞助 $1,700，30% 约 $1,290，覆盖保底 1.17 倍；赞助收入波动大。", "AdSense averages $2,600 plus $1,700 in sponsorships; 30% is about $1,290, 1.17× the floor. Sponsorship income is lumpy."),
    flags: [
      ["medium", L_("平台政策风险", "Platform risk"), L_("YouTube 广告政策变化可导致收入骤降。", "A YouTube ad-policy change could cut income sharply.")],
      ["medium", L_("依赖创作者本人", "Depends on the creator"), L_("赞助收入几乎完全依赖 Rafael 出镜。", "Sponsorship income depends almost entirely on Rafael on camera.")],
    ],
    monitoring: [L_("月观看低于 400 万", "Monthly views below 4M"), L_("连续 3 周断更", "Three weeks without an upload")],
    monthlyBase: 4_300,
    margin: 1,
    qa: [],
    docs: [
      ["registry", L_("CNPJ 登记", "CNPJ registration")],
      ["royalty", L_("YouTube Studio 只读授权", "YouTube Studio read-only grant")],
      ["agreement", L_("收入分成协议", "Revenue-share agreement")],
    ],
    demand: 1.05,
    holders: 2_610,
    vol: 0.045,
  },
  {
    symbol: "WASH",
    name: "Al Noor Express Car Wash",
    tagline: L_("迪拜 Al Quoz 的隧道式自动洗车，出让 40% 股权", "Tunnel car wash in Al Quoz, Dubai — 40% equity"),
    about: L_("日均 380 台车，会员订阅占营收 41%。融资用于第二条洗车隧道。", "About 380 cars a day; memberships are 41% of revenue. Raising for a second tunnel."),
    terms: L_("40% 股权 · 每季度分红 $13,000 · 保证金 1 个季度", "40% equity · $13,000 quarterly dividend · 1-quarter bond"),
    category: "carwash",
    country: "AE",
    city: L_("迪拜", "Dubai"),
    hue: 196,
    owner: { name: "Yousef Al Mansoori", title: L_("经理", "manager"), since: 2019 },
    entity: "Al Noor Express Car Wash LLC",
    instrument: "equity",
    companyPct: 40,
    stage: "ipo",
    ipoPrice: 1,
    price: 1,
    sharesForSale: 400_000,
    raisedPct: 0.18,
    investors: 96,
    ipoDeadlineIn: 12,
    perPeriod: 13_000,
    periodDays: QUARTER,
    numPeriods: 8,
    reliability: 0.93,
    score: [21, 18, 17, 19, 7],
    metrics: [
      [L_("Google 评分", "Google rating"), "4.4 ★ (2,210)"],
      [L_("日均车次", "Cars per day"), "≈380"],
      [L_("会员数", "Members"), "1,860"],
    ],
    presence: L_("Google 4.4 星、2,210 条评价；会员 App 在 App Store 评分 4.6。", "4.4★ with 2,210 Google reviews; the membership app is rated 4.6 on the App Store."),
    financials: L_("会员订阅通过 Stripe 收取，可只读核对；单店月营收约 $16 万，净利率约 24%。", "Memberships bill through Stripe and are verifiable read-only; about $160K monthly revenue at roughly 24% net margin."),
    license: L_("迪拜 DET 商业执照与市政环保许可有效。", "Dubai DET trade licence and municipal environmental permit are valid."),
    flags: [["medium", L_("夏季淡季", "Summer slowdown"), L_("6–8 月车次下降约 25%。", "Car counts drop about 25% from June to August.")]],
    monitoring: [L_("会员数低于 1,500", "Members below 1,500")],
    monthlyBase: 160_000,
    margin: 0.24,
    seasonal: [1.1, 1.1, 1.08, 1.02, 0.95, 0.8, 0.76, 0.78, 0.9, 1.05, 1.12, 1.14],
    qa: [
      {
        who: "Fatima",
        q: L_("第二条隧道需要的市政审批拿到了吗？", "Do you have the municipal approval for the second tunnel?"),
        a: L_("已获批，许可编号和图纸在文件区。", "Yes; the permit number and plans are in Documents."),
        hoursAgo: 150,
        votes: 24,
      },
    ],
    docs: [
      ["registry", L_("DET 商业执照", "DET trade licence")],
      ["pos", L_("Stripe 只读授权", "Stripe read-only grant")],
      ["license", L_("市政环保许可", "Municipal environmental permit")],
    ],
    demand: 0.8,
    holders: 96,
    vol: 0.03,
  },
  {
    symbol: "BALI",
    name: "Ubud Terrace Villas",
    tagline: L_("巴厘岛乌布梯田边的 9 栋别墅，出让 15% 股权", "Nine villas on the rice terraces of Ubud, Bali — 15% equity"),
    about: L_("Airbnb 超赞房东，年均入住率 78%。预订数据通过 Airbnb 与 Booking.com 只读授权获取。", "Airbnb Superhost with 78% average occupancy. Bookings come from read-only Airbnb and Booking.com grants."),
    terms: L_("15% 股权 · 每季度分红 $15,000 · 2 年", "15% equity · $15,000 quarterly dividend · 2 years"),
    category: "hotel",
    country: "ID",
    city: L_("巴厘岛", "Bali"),
    hue: 88,
    owner: { name: "Made Wirawan", title: L_("董事", "director"), since: 2016 },
    entity: "PT Ubud Terrace Villas",
    instrument: "equity",
    companyPct: 15,
    stage: "trading",
    ipoPrice: 1,
    price: 1.21,
    sharesForSale: 600_000,
    investors: 3_350,
    nextDueIn: 55,
    perPeriod: 15_000,
    periodDays: QUARTER,
    numPeriods: 8,
    reliability: 0.94,
    past: ["paid", "paid"],
    score: [21, 15, 19, 19, 6],
    metrics: [
      [L_("Airbnb 评分", "Airbnb rating"), "4.93 (1,480)"],
      [L_("入住率", "Occupancy"), "78%"],
      [L_("平均房价", "Average nightly rate"), "$186"],
    ],
    presence: L_("Airbnb 4.93 分、超赞房东 6 年；Booking.com 9.4 分。", "4.93 on Airbnb and Superhost for six years; 9.4 on Booking.com."),
    financials: L_("平台结算数据与银行入账一致，年营收约 $46 万。", "Platform payouts match bank deposits; about $460K a year in revenue."),
    flags: [
      ["medium", L_("外资持股规则", "Foreign ownership rules"), L_("印尼 PMA 规定限制部分行业外资比例，本项目通过境外 SPV 持有分红权，需关注政策变化。", "Indonesia's PMA rules cap foreign ownership in some sectors; holders own dividend rights via an offshore SPV, so policy changes matter.")],
      ["low", L_("季节性", "Seasonality"), L_("雨季（1–3 月）入住率降至约 60%。", "Occupancy falls to about 60% in the rainy season (Jan–Mar).")],
    ],
    monitoring: [L_("入住率低于 60%", "Occupancy below 60%")],
    monthlyBase: 38_000,
    margin: 0.42,
    seasonal: [0.7, 0.68, 0.8, 0.95, 1.05, 1.15, 1.3, 1.32, 1.12, 1.0, 0.92, 1.1],
    qa: [],
    docs: [
      ["registry", L_("OSS 营业许可（NIB）", "OSS business licence (NIB)")],
      ["pos", L_("Airbnb 只读授权", "Airbnb read-only grant")],
      ["agreement", L_("SPV 分红权协议", "SPV dividend-rights agreement")],
    ],
    demand: 1,
    holders: 3_350,
    vol: 0.025,
  },
  {
    symbol: "VOLT",
    name: "Kreuzberg Charge Hub",
    tagline: L_("柏林十字山 12 桩快充站，充电收入 40% 分 8 年", "12-bay fast-charging hub in Kreuzberg, Berlin — 40% of charging revenue for 8 years"),
    about: L_("认购已成团，商户已签署转让协议并上传了商业登记变更，平台审核通过后进入交割，投资人逐个确认收货后放款。", "The round filled. The merchant signed the transfer agreement and uploaded the registry change; once the platform verifies it, each investor confirms receipt to release their payment."),
    terms: L_("充电收入 40% · 每季度 · 保底 $8,400 · 8 年", "40% of charging revenue · quarterly · $8,400 floor · 8 years"),
    category: "ev",
    country: "DE",
    city: L_("柏林", "Berlin"),
    hue: 222,
    owner: { name: "Jana Becker", title: L_("总经理", "managing director"), since: 2022 },
    entity: "Kreuzberg Charge GmbH",
    instrument: "revenue_share",
    companyPct: 40,
    stage: "settling",
    ipoPrice: 1,
    price: 1,
    sharesForSale: 350_000,
    investors: 1_730,
    settlingSinceDays: 6,
    perPeriod: 8_400,
    periodDays: QUARTER,
    numPeriods: 32,
    reliability: 0.95,
    score: [23, 19, 16, 21, 8],
    metrics: [
      [L_("充电桩", "Charging bays"), "12 × 150 kW"],
      [L_("利用率", "Utilisation"), "31%"],
      [L_("月充电收入", "Monthly charging revenue"), "$26,500"],
    ],
    presence: L_("站点在 PlugShare 评分 9.1，Google 4.6 星；运营后台（OCPP）只读接入。", "9.1 on PlugShare and 4.6★ on Google; the OCPP back office is connected read-only."),
    financials: L_("OCPP 计费数据与银行入账一致，月收入约 $2.65 万，40% 对应 $1.06 万/月。", "OCPP billing data matches deposits; about $26.5K a month, 40% of which is $10.6K."),
    flags: [["low", L_("电价波动", "Power prices"), L_("批发电价上涨会压缩毛利。", "Rising wholesale power prices would compress margins.")]],
    monitoring: [L_("利用率低于 20%", "Utilisation below 20%")],
    monthlyBase: 26_500,
    margin: 0.5,
    qa: [],
    docs: [
      ["registry", L_("商业登记摘录（HRB）", "Commercial register extract (HRB)")],
      ["pos", L_("OCPP 后台只读授权", "OCPP back-office read-only grant")],
      ["agreement", L_("已签署的收入分成转让协议", "Signed revenue-share transfer agreement")],
    ],
    demand: 1,
    holders: 1_730,
    vol: 0.02,
  },
  {
    symbol: "BOBA",
    name: "Taro & Tapioca",
    tagline: L_("台北信义区手摇饮，上季度分红违约，保证金已赔付", "Bubble-tea shop in Xinyi, Taipei — missed last quarter; bond paid holders"),
    about: L_(
      "8 月对面开了连锁竞品后营业额下滑，上季度没有按时分红。合约在宽限期结束后自动罚没保证金并分给持有人，违约记录永久写在链上。",
      "Sales fell after a chain competitor opened across the street in August, and last quarter's dividend wasn't paid. After the grace period the contract slashed the bond to holders automatically, and the default is on-chain for good.",
    ),
    terms: L_("35% 股权 · 每季度分红 $4,800 · 保证金已耗尽", "35% equity · $4,800 quarterly dividend · bond exhausted"),
    category: "teashop",
    country: "TW",
    city: L_("台北", "Taipei"),
    hue: 330,
    owner: { name: "陈怡君 Chen Yi-chun", title: L_("负责人", "owner"), since: 2019 },
    entity: "芋圆珍珠有限公司",
    instrument: "equity",
    companyPct: 35,
    stage: "trading",
    ipoPrice: 1,
    price: 0.62,
    sharesForSale: 150_000,
    investors: 760,
    nextDueIn: 63,
    perPeriod: 4_800,
    periodDays: QUARTER,
    numPeriods: 8,
    reliability: 0.55,
    past: ["paid", "paid", "defaulted"],
    score: [20, 16, 10, 7, 5],
    summary: L_(
      "AI 哨兵在 8 月发现 POS 营业额下降 41% 并发出预警；上季度违约后保证金已罚没分配。信用评级从 B 下调至 D。",
      "The AI monitor flagged a 41% POS revenue drop in August. After last quarter's default the bond was slashed to holders. Rating cut from B to D.",
    ),
    metrics: [
      [L_("Google 评分", "Google rating"), "4.1 ★ (640)"],
      [L_("POS 营业额（近 3 月）", "POS revenue (3 mo)"), "−41%"],
      [L_("履约记录", "Payment record"), L_("2 按时 / 1 违约", "2 paid / 1 default")],
    ],
    presence: L_("Google 评分从 4.5 降到 4.1；近 60 天新评价数量减少一半。", "Google rating fell from 4.5 to 4.1; new reviews halved in 60 days."),
    financials: L_("8 月起 POS 营业额下降 41%，当前利润不足以覆盖承诺分红。", "POS revenue down 41% since August; current profit doesn't cover the promised dividend."),
    flags: [
      ["high", L_("上季度违约", "Defaulted last quarter"), L_("宽限期后保证金 $4,800 已罚没并分给持有人。", "After the grace period the $4,800 bond was slashed and paid to holders.")],
      ["high", L_("营业额骤降", "Revenue collapse"), L_("POS 数据显示 8 月起营业额下降 41%。", "POS data shows revenue down 41% since August.")],
      ["medium", L_("保证金已耗尽", "Bond exhausted"), L_("下期分红没有保证金兜底，除非老板补充。", "Next period has no bond behind it unless the owner tops it up.")],
    ],
    monitoring: [L_("老板补充保证金", "Owner tops up the bond"), L_("POS 营业额恢复到 8 月前 80%", "POS revenue back to 80% of pre-August")],
    monthlyBase: 21_000,
    margin: 0.08,
    seasonal: [1.05, 1.0, 1.02, 1.08, 1.12, 1.15, 1.18, 0.7, 0.62, 0.6, 0.58, 0.6],
    qa: [
      {
        who: "阿哲",
        q: L_("这季度没分红，下季度还会付吗？有没有补救计划？", "No dividend this quarter. Will you pay next quarter? What's the recovery plan?"),
        a: L_("我们正在把菜单改成低糖鲜果茶，并上线外送平台。下季度我会先补充 $4,800 保证金，再尽量按时分红。", "We're switching to low-sugar fresh-fruit teas and adding delivery apps. I'll top the bond back up by $4,800 before next quarter and aim to pay on time."),
        hoursAgo: 120,
        votes: 74,
        evasive: 9,
      },
      {
        who: "Linh",
        q: L_("违约之后老板的工资有没有下调？", "Did the owner cut her own salary after the default?"),
        hoursAgo: 60,
        votes: 41,
      },
    ],
    docs: [
      ["registry", L_("商工登记资料", "Commercial registration")],
      ["pos", L_("iCHEF POS 只读授权", "iCHEF POS read-only grant")],
      ["bank", L_("银行流水 12 个月", "Bank statements, 12 months")],
    ],
    demand: 0.5,
    holders: 760,
    vol: 0.06,
  },
  {
    symbol: "PAWS",
    name: "Lone Star Pet Supply",
    tagline: L_("奥斯汀的亚马逊 FBA 宠物用品店，AI 正在审核", "Amazon FBA pet-supply store from Austin — AI review in progress"),
    about: L_("年销售额约 $210 万，Amazon Seller Central 只读授权已连接。AI 尽调完成后进入公开问答期。", "About $2.1M in yearly sales with a read-only Seller Central grant connected. Goes to public Q&A once the AI review finishes."),
    terms: L_("销售额 6% · 每月 · 保底 $8,000 · 3 年", "6% of sales · monthly · $8,000 floor · 3 years"),
    category: "ecommerce",
    country: "US",
    city: L_("奥斯汀", "Austin"),
    hue: 240,
    owner: { name: "Hannah Brooks", title: L_("所有人", "owner"), since: 2020 },
    entity: "Lone Star Pet Supply LLC",
    instrument: "revenue_share",
    companyPct: 6,
    stage: "review",
    ipoPrice: 1,
    price: 1,
    sharesForSale: 500_000,
    investors: 0,
    perPeriod: 8_000,
    periodDays: MONTH,
    numPeriods: 36,
    reliability: 0.92,
    metrics: [],
    presence: L_("", ""),
    financials: L_("", ""),
    flags: [],
    monitoring: [],
    monthlyBase: 175_000,
    margin: 0.12,
    qa: [],
    docs: [
      ["registry", L_("得州州务卿登记", "Texas SOS filing")],
      ["pos", L_("Seller Central 只读授权", "Seller Central read-only grant")],
    ],
    demand: 1,
    holders: 0,
    vol: 0.03,
  },
];

export function defaultDraft(): Draft {
  return {
    step: 0,
    name: "Lantern Noodle House",
    category: "restaurant",
    city: "Vancouver",
    country: "CA",
    mapsUrl: "https://maps.google.com/?q=Lantern+Noodle+House+Vancouver",
    instagram: "@lanternnoodles",
    website: "https://example.com/lantern",
    ownerName: "Grace Liu",
    entityName: "Lantern Noodle House Ltd.",
    jurisdiction: "ca_bc",
    about: "",
    monthlyRevenue: 72_000,
    margin: 0.14,
    docs: [],
    instrument: "equity",
    companyPct: 25,
    target: 200_000,
    minRaisePct: 80,
    durationDays: 14,
    perPeriod: 6_000,
    periodDays: 91,
    numPeriods: 8,
    pricing: "auction",
  };
}

function demoWallet(assets: Asset[], now: number): Me {
  const me: Me = {
    name: "You",
    country: "CN",
    usdt: 2_500,
    xp: 180,
    badges: ["first", "early"],
    positions: {},
    escrow: [],
    orders: [],
    trades: [],
    bets: [],
    claimedTotal: 0,
    asked: 0,
    merchantAssetId: null,
    faucetAt: 0,
    welcomed: false,
    autoReinvest: false,
    reinvested: 0,
    merchantDefaults: 0,
  };
  const find = (id: string) => assets.find((a) => a.id === id)!;

  // Holdings bought earlier: dividends since purchase are claimable, history before stays with the seller.
  const give = (id: string, qty: number, cost: number, boughtBeforeDps: number) => {
    const pos = emptyPosition();
    moveShares(pos, qty, boughtBeforeDps);
    pos.cost = cost;
    me.positions[id] = pos;
    me.trades.push({ id: `seed-${id}`, assetId: id, side: "buy", price: cost / qty, size: qty, usdt: cost, fee: cost * 0.005, at: now - 40 * DAY });
  };
  const rain = find("rain");
  give("rain", 800, 860, rain.dps - (1_400 * 3) / rain.totalShares);
  const kaze = find("kaze");
  give("kaze", 300, 510, kaze.dps - 7_200 / kaze.totalShares);

  // An escrow order in a round that has been delivered: ready for 确认收货.
  me.escrow.push({ id: "e-volt", assetId: "volt", budget: 500, tick: 0, withdrawn: 0, state: "active", at: now - 30 * DAY });
  // A live bid in the Neon Coyote auction, at the top of the ladder (still pays the clearing price).
  const ncb = find("ncb");
  me.escrow.push({ id: "e-ncb", assetId: "ncb", budget: 300, tick: ncb.offering.prices.length - 1, withdrawn: 0, state: "active", at: now - 2 * DAY });
  ncb.offering.tickBudget[ncb.offering.prices.length - 1] += 300;
  ncb.offering.committed += 300;
  const kazeMarket = kaze.markets[0];
  if (kazeMarket) {
    kazeMarket.myYes = 40;
    kazeMarket.yes += 40;
    me.bets.push({ id: "b-kaze", assetId: "kaze", period: kazeMarket.period, side: "yes", amount: 40, at: now - 5 * DAY });
  }
  return me;
}

/** The other investors on the leaderboards: holdings bought at different times, and a confidence-market record. */
function seedRivals(assets: Asset[]): Rival[] {
  const r = mulberry32(hashString("rivals"));
  const trading = assets.filter((a) => a.stage === "trading");
  return PEOPLE.map((p) => {
    const skill = r();
    const rival: Rival = { name: p.name, country: p.country, positions: {}, bets: [], oracle: { n: 0, hits: 0, pnl: 0 } };
    const picks = 1 + Math.floor(r() * 3);
    for (let k = 0; k < picks; k++) {
      const a = trading[Math.floor(r() * trading.length)];
      if (rival.positions[a.id]) continue;
      const pos = emptyPosition();
      const qty = Math.round(a.totalShares * (0.003 + r() * 0.03));
      moveShares(pos, qty, a.dps * r() * 0.7); // bought partway through the payout history
      pos.cost = qty * a.price * (0.8 + r() * 0.3);
      pos.withdrawn = claimable(pos, a.dps) * (0.4 + r() * 0.6);
      rival.positions[a.id] = pos;
    }
    const calls = Math.floor(r() * 15);
    for (let k = 0; k < calls; k++) {
      const stake = 20 + r() * 230;
      const hit = r() < 0.3 + skill * 0.4;
      rival.oracle.n += 1;
      if (hit) rival.oracle.hits += 1;
      rival.oracle.pnl += hit ? stake * (0.2 + r() * 1.1) : -stake;
    }
    return rival;
  });
}

export function createWorld(now = Date.now()): State {
  const assets = SPECS.map((s) => buildAsset(s, now));

  // VOLT: the platform verified the registry change two days ago; investors are confirming receipt.
  const volt = assets.find((a) => a.id === "volt")!;
  volt.offering.registrationProof = fakeHash("volt-registry");
  volt.offering.proofUploadedAt = now - 3 * DAY;
  volt.offering.deliveredAt = now - 2 * DAY;

  const state: State = {
    v: 5,
    offset: 0,
    lastDay: Math.floor(now / DAY),
    lang: "zh",
    theme: "system",
    route: "market",
    assets,
    me: demoWallet(assets, now),
    rivals: seedRivals(assets),
    feed: [],
    notices: [
      {
        id: "n-volt",
        at: now - 2 * DAY,
        text: L_("Kreuzberg Charge Hub 已完成商业登记变更核验，请确认收货以领取份额。", "Kreuzberg Charge Hub's registry change is verified. Confirm receipt to receive your shares."),
        assetId: "volt",
        tone: "good",
        read: false,
      },
      {
        id: "n-boba",
        at: now - 9 * DAY,
        text: L_("Taro & Tapioca 上季度分红违约，保证金 $4,800 已自动分给持有人。", "Taro & Tapioca missed last quarter's dividend; its $4,800 bond was paid to holders automatically."),
        assetId: "boba",
        tone: "bad",
        read: true,
      },
    ],
    draft: defaultDraft(),
    seq: 1,
  };
  return state;
}
