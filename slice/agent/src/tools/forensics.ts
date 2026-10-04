/**
 * Deterministic cash-flow forensics. The model extracts numbers from bank statements; this code does the
 * arithmetic, so a trust score never depends on the model doing statistics in its head.
 */

export interface MonthlyPoint {
  period: string; // "2026-03"
  amount: number; // total deposits that month
}

export interface ForensicsInput {
  monthly: MonthlyPoint[];
  transactions?: number[]; // individual deposit amounts, if extracted
  claimedMonthlyRevenue?: number | null;
}

export interface ForensicsResult {
  months: number;
  mean: number;
  median: number;
  stdev: number;
  coefficientOfVariation: number;
  maxMonthOverMonthDrop: number;
  maxMonthOverMonthJump: number;
  trailing3vsPrior3: number | null;
  claimedVsObserved: number | null;
  roundNumberShare: number | null;
  largestDepositShare: number | null;
  benford: { chiSquare: number; suspicious: boolean; sample: number } | null;
  flags: string[];
}

const BENFORD = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
// chi-square critical value, 8 degrees of freedom, p = 0.01
const BENFORD_CRITICAL = 20.09;

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function cashflowForensics(input: ForensicsInput): ForensicsResult {
  const amounts = input.monthly.map((m) => m.amount);
  const n = amounts.length;
  const flags: string[] = [];
  if (n === 0) {
    return {
      months: 0,
      mean: 0,
      median: 0,
      stdev: 0,
      coefficientOfVariation: 0,
      maxMonthOverMonthDrop: 0,
      maxMonthOverMonthJump: 0,
      trailing3vsPrior3: null,
      claimedVsObserved: null,
      roundNumberShare: null,
      largestDepositShare: null,
      benford: null,
      flags: ["NO_DATA: no monthly deposits were provided"],
    };
  }

  const mean = amounts.reduce((a, b) => a + b, 0) / n;
  const sorted = [...amounts].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const stdev = Math.sqrt(amounts.reduce((a, x) => a + (x - mean) ** 2, 0) / n);
  const cv = mean === 0 ? 0 : stdev / mean;

  let maxDrop = 0;
  let maxJump = 0;
  for (let i = 1; i < n; i++) {
    if (amounts[i - 1] === 0) continue;
    const change = (amounts[i] - amounts[i - 1]) / amounts[i - 1];
    maxDrop = Math.min(maxDrop, change);
    maxJump = Math.max(maxJump, change);
  }

  let trend: number | null = null;
  if (n >= 6) {
    const last3 = amounts.slice(-3).reduce((a, b) => a + b, 0);
    const prior3 = amounts.slice(-6, -3).reduce((a, b) => a + b, 0);
    trend = prior3 === 0 ? null : last3 / prior3 - 1;
  }

  const claimed = input.claimedMonthlyRevenue ?? null;
  const claimedVsObserved = claimed && mean ? claimed / mean - 1 : null;

  if (n < 6) flags.push(`SHORT_HISTORY: only ${n} months of statements (ask for 12)`);
  if (cv > 0.35) flags.push(`VOLATILE: month-to-month coefficient of variation ${round(cv, 2)}`);
  if (maxDrop < -0.4) flags.push(`SHARP_DROP: a month fell ${Math.round(-maxDrop * 100)}% vs the previous month`);
  if (maxJump > 0.6) {
    flags.push(`SPIKE: a month jumped ${Math.round(maxJump * 100)}% (check for injected cash before listing)`);
  }
  if (trend !== null && trend < -0.2) flags.push(`DECLINING: last 3 months are ${Math.round(-trend * 100)}% below the 3 before`);
  if (claimedVsObserved !== null && Math.abs(claimedVsObserved) > 0.15) {
    flags.push(
      `CLAIM_MISMATCH: claimed revenue is ${Math.round(claimedVsObserved * 100)}% vs average observed deposits`,
    );
  }

  let roundShare: number | null = null;
  let largestShare: number | null = null;
  let benford: ForensicsResult["benford"] = null;
  const tx = (input.transactions ?? []).filter((x) => x > 0);
  if (tx.length > 0) {
    roundShare = tx.filter((x) => x >= 100 && x % 100 === 0).length / tx.length;
    const total = tx.reduce((a, b) => a + b, 0);
    largestShare = Math.max(...tx) / total;
    if (roundShare > 0.3) flags.push(`ROUND_NUMBERS: ${Math.round(roundShare * 100)}% of deposits are round hundreds`);
    if (largestShare > 0.25) {
      flags.push(`CONCENTRATION: one deposit is ${Math.round(largestShare * 100)}% of all deposits in the period`);
    }
    if (tx.length >= 50) {
      const counts = new Array(9).fill(0);
      for (const x of tx) {
        const d = Number(String(Math.floor(x)).replace(/^0+/, "")[0]);
        if (d >= 1 && d <= 9) counts[d - 1]++;
      }
      const sample = counts.reduce((a, b) => a + b, 0);
      const chi = counts.reduce((acc, c, i) => acc + (c - sample * BENFORD[i]) ** 2 / (sample * BENFORD[i]), 0);
      benford = { chiSquare: round(chi, 2), suspicious: chi > BENFORD_CRITICAL, sample };
      if (benford.suspicious) flags.push(`BENFORD: first-digit distribution deviates (chi2=${round(chi, 1)})`);
    }
  }

  return {
    months: n,
    mean: round(mean, 2),
    median: round(median, 2),
    stdev: round(stdev, 2),
    coefficientOfVariation: round(cv),
    maxMonthOverMonthDrop: round(maxDrop),
    maxMonthOverMonthJump: round(maxJump),
    trailing3vsPrior3: trend === null ? null : round(trend),
    claimedVsObserved: claimedVsObserved === null ? null : round(claimedVsObserved),
    roundNumberShare: roundShare === null ? null : round(roundShare),
    largestDepositShare: largestShare === null ? null : round(largestShare),
    benford,
    flags,
  };
}
