export type Lang = "zh" | "en";
/** A bilingual string. */
export type L = { zh: string; en: string };

export type Category =
  | "bar"
  | "restaurant"
  | "cafe"
  | "teashop"
  | "music"
  | "ecommerce"
  | "game"
  | "creator"
  | "energy"
  | "hotel"
  | "carwash"
  | "ev";

export type Instrument = "equity" | "dividend_rights" | "revenue_share";

/** review → qa → ipo → settling → trading (or failed). Mirrors SliceHub + EscrowOffering phases. */
export type Stage = "review" | "qa" | "ipo" | "settling" | "trading" | "failed";
export type PeriodStatus = "pending" | "paid" | "late" | "defaulted";

export interface Person {
  name: string;
  country: string; // ISO-3166 alpha-2
}

export interface Offering {
  price: number; // USDT per share
  sharesForSale: number;
  minRaise: number;
  sold: number;
  raised: number;
  investors: number;
  opensAt: number;
  deadline: number;
  settleDeadline: number | null;
  agreementHash: string | null;
  agreementAt: number | null;
  registrationProof: string | null;
  proofUploadedAt: number | null;
  deliveredAt: number | null;
  confirmDays: number;
  settleDays: number;
  feeBps: number;
  merchantReceived: number;
}

export interface Commitment {
  perPeriod: number;
  periodDays: number;
  firstDue: number;
  numPeriods: number;
  graceDays: number;
  bond: number;
  status: PeriodStatus[];
  paid: number[];
  /** Simulation only: chance a bot-run merchant pays each period on time. */
  reliability: number;
}

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type Severity = "high" | "medium" | "low";

export interface Check {
  category: "identity" | "registry" | "presence" | "reputation" | "financials" | "legal" | "license";
  title: L;
  status: CheckStatus;
  finding: L;
  evidence: { label: string; url?: string }[];
}

export interface Audit {
  trustScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: "pass" | "review" | "reject";
  summary: L;
  breakdown: { identity: number; registry: number; presence: number; financials: number; legal: number };
  metrics: { label: L; value: string | L }[];
  checks: Check[];
  flags: { severity: Severity; title: L; detail: L }[];
  monitoring: L[];
  auditedAt: number;
  auditHash: string;
  source: "demo" | "agent";
}

export interface Question {
  id: string;
  author: Person;
  text: L;
  at: number;
  votes: number;
  voted?: boolean;
  evasive: number;
  markedEvasive?: boolean;
  ai?: boolean;
  mine?: boolean;
  answer?: { text: L; at: number; doc?: string };
}

export type DocKind = "registry" | "id" | "bank" | "tax" | "lease" | "license" | "pos" | "agreement" | "royalty" | "other";

export interface Doc {
  id: string;
  name: L;
  kind: DocKind;
  hash: string;
  at: number;
  byRequest?: boolean;
  verified: boolean;
}

export interface BookLevel {
  price: number;
  size: number;
  mine?: string; // id of my open order at this level
}

export interface ConfMarket {
  period: number;
  yes: number;
  no: number;
  myYes: number;
  myNo: number;
  resolved: null | "yes" | "no";
  claimed: boolean;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface Asset {
  id: string;
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
  instrument: Instrument;
  companyPct: number;
  stage: Stage;
  qaEndsAt: number | null;
  listedAt: number | null;
  offering: Offering;
  commitment: Commitment;
  audit: Audit | null;
  qa: Question[];
  docs: Doc[];
  totalShares: number;
  price: number;
  history: PricePoint[]; // daily
  intraday: PricePoint[];
  dps: number; // cumulative USDT distributed per share
  distributed: number;
  holders: number;
  monthly: number[]; // last 12 months revenue, USDT
  margin: number;
  volume24h: number;
  markets: ConfMarket[];
  mine?: boolean;
  demand: number; // simulation: how fast bots subscribe / buy
}

export interface Position {
  shares: number;
  locked: number;
  cost: number;
  corr: number; // dividend correction, mirrors ShareToken.magnifiedDividendCorrections
  withdrawn: number;
}

export interface EscrowOrder {
  id: string;
  assetId: string;
  paid: number;
  shares: number;
  state: "active" | "confirmed" | "disputed" | "refunded";
  at: number;
  closedAt?: number;
  auto?: boolean;
  disputeReason?: string;
}

export interface OpenOrder {
  id: string;
  assetId: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  filled: number;
  escrow: number; // USDT held for a buy
  at: number;
}

export interface Trade {
  id: string;
  assetId: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  usdt: number;
  fee: number;
  at: number;
  maker?: boolean;
}

export interface Bet {
  id: string;
  assetId: string;
  period: number;
  side: "yes" | "no";
  amount: number;
  at: number;
}

export type FeedKind =
  | "buy"
  | "sell"
  | "subscribe"
  | "dividend"
  | "default"
  | "ask"
  | "answer"
  | "bet"
  | "listed"
  | "delivered";

export interface FeedItem {
  id: string;
  at: number;
  kind: FeedKind;
  who: Person;
  assetId: string;
  amount?: number;
}

export interface Notice {
  id: string;
  at: number;
  text: L;
  assetId?: string;
  tone: "good" | "info" | "warn" | "bad";
  read: boolean;
}

export interface Me {
  name: string;
  country: string;
  usdt: number;
  xp: number;
  badges: string[];
  positions: Record<string, Position>;
  escrow: EscrowOrder[];
  orders: OpenOrder[];
  trades: Trade[];
  bets: Bet[];
  claimedTotal: number;
  asked: number;
  merchantAssetId: string | null;
  faucetAt: number;
  welcomed: boolean;
  granted?: boolean;
}

export interface Draft {
  step: number;
  name: string;
  category: Category;
  city: string;
  country: string;
  mapsUrl: string;
  instagram: string;
  website: string;
  ownerName: string;
  entityName: string;
  jurisdiction: string;
  about: string;
  monthlyRevenue: number;
  margin: number;
  docs: Doc[];
  instrument: Instrument;
  companyPct: number;
  target: number;
  minRaisePct: number;
  durationDays: number;
  perPeriod: number;
  periodDays: number;
  numPeriods: number;
  bondPeriods: number;
}

export interface State {
  v: number;
  offset: number; // simulated clock = Date.now() + offset
  lastDay: number; // last processed simulated day index
  lang: Lang;
  theme: "system" | "light" | "dark";
  route: string;
  assets: Asset[];
  me: Me;
  feed: FeedItem[];
  notices: Notice[];
  draft: Draft;
  seq: number;
}
