/**
 * scripts/seed-scenarios.ts
 *
 * Produces three pre-computed demo scenarios under data/scenarios/:
 *   • agency.json      — lumpy retainer + project flow (Brightline Studio)
 *   • retail.json      — high-volume daily Stripe/Square + inventory burn
 *   • tax-crisis.json  — modest balance, massive Q2 federal tax incoming
 *
 * Each output bundle contains {meta, transactions, categorized, forecast,
 * at_risk_weeks, explanations} so the dashboard can swap scenarios with no
 * additional API calls. Explanations are template-generated from the
 * driver transactions in each at-risk week — zero hallucination by
 * construction (every cited description is mechanically copied from the
 * input data).
 *
 * Run:  node --experimental-strip-types scripts/seed-scenarios.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildForecast } from "../lib/forecast.ts";
import type {
  CategorizedTransaction,
  Category,
  Explanation,
  ForecastResult,
  Transaction,
  AtRiskWeek,
} from "../lib/types.ts";

// ============== shared primitives ==============
const TODAY = new Date("2026-04-26T12:00:00Z");

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ============== rule-based categorizer (same as scripts/categorize.ts) ==============
type Rule = { test: RegExp; category: Category; recurring: boolean; conf: number };
const RULES: Rule[] = [
  { test: /RETAINER/i, category: "income", recurring: true, conf: 0.97 },
  { test: /(STRIPE PAYOUT|SQUARE PAYOUT|SHOPIFY PAYOUTS)/i, category: "income", recurring: true, conf: 0.92 },
  // Construction / consulting recurring income patterns (must come BEFORE
  // the generic customer_payment rule so MILESTONE / DRAW / ACH on a
  // regular cadence get flagged as recurring).
  { test: /\b(MILESTONE|PROGRESS DRAW|MONTHLY DRAW|RECURRING ACH|MO\.? RECURRING)\b/i, category: "income", recurring: true, conf: 0.9 },
  { test: /(INVOICE|INV-|PROJECT|WEBSITE BUILD|DESIGN SPRINT|CONSULTING|PHASE|DEPOSIT)/i, category: "customer_payment", recurring: false, conf: 0.86 },
  { test: /(PAYROLL|GUSTO|RIPPLING|JUSTWORKS)/i, category: "payroll", recurring: true, conf: 0.99 },
  { test: /(RENT|PROPERTIES|LANDLORD|MORTGAGE)/i, category: "rent_or_mortgage", recurring: true, conf: 0.98 },
  { test: /(CON ED|ELECTRIC|GAS UTIL|WATER|VERIZON BUSINESS|AT&T BUSINESS|INTERNET|COMCAST)/i, category: "utilities", recurring: true, conf: 0.94 },
  { test: /(ADOBE|FIGMA|NOTION|HUBSPOT|SLACK|ZOOM|GOOGLE WORKSPACE|AWS|LINEAR|GITHUB|SHOPIFY APP|QUICKBOOKS|XERO|MAILCHIMP|KLAVIYO)/i, category: "subscriptions", recurring: true, conf: 0.95 },
  { test: /(HISCOX|ANTHEM|ZURICH|HEALTH|INSURANCE|BCBS)/i, category: "subscriptions", recurring: true, conf: 0.9 },
  { test: /(401K|FIDELITY)/i, category: "payroll", recurring: true, conf: 0.88 },
  { test: /(LOAN|SBL|PMT)/i, category: "loan_payment", recurring: true, conf: 0.95 },
  { test: /(IRS|USATAXPYMT|NYS|SALES TAX|TAX|DTF|FRANCHISE|UNEMPLOYMENT)/i, category: "tax", recurring: true, conf: 0.93 },
  { test: /TRANSFER (TO|FROM)/i, category: "transfer", recurring: false, conf: 0.99 },
  { test: /(INVENTORY|WHOLESALE|SUPPLIER|VENDOR|HERMAN MILLER|WEWORK|K&L GATES|JONES & CO|CPA|AMAZON BUSINESS|STAPLES|HOLIDAY PARTY|BONUS|FAIRE|ALIBABA|UPS FREIGHT)/i, category: "vendor_payment", recurring: false, conf: 0.85 },
  { test: /(DELTA|UBER|TRAVEL|AIRLINES|CONFERENCE TICKETS|HOTEL)/i, category: "vendor_payment", recurring: false, conf: 0.84 },
  { test: /(STRIPE FEE|SQUARE FEE|MERCHANT FEE|PROCESSING)/i, category: "subscriptions", recurring: true, conf: 0.85 },
];
function categorize(t: Transaction): CategorizedTransaction {
  for (const r of RULES) {
    if (r.test.test(t.description)) {
      return { ...t, category: r.category, is_recurring: r.recurring, confidence: r.conf };
    }
  }
  return { ...t, category: "other", is_recurring: false, confidence: 0.4 };
}

// ============== templated explanation generator (zero-hallucination) ==============
const ACTION_BY_CATEGORY: Record<Category, string> = {
  payroll: "consider asking a top customer to settle a few days earlier so cash lands before payday, or move payroll to the day after the largest retainer hits",
  tax: "carve the federal tax payment into a separate sub-account at the start of each quarter so it isn't competing with operating cash",
  rent_or_mortgage: "ask the landlord to shift the due date to mid-month so it lands after retainers clear, or stagger by paying half on the 1st and half on the 15th",
  utilities: "switch utilities to autopay on the 20th so they don't compete with first-of-month rent and payroll",
  subscriptions: "audit the recurring SaaS bills landing this week — many can be paused, downgraded, or shifted to annual billing",
  loan_payment: "talk to the lender about a one-month deferral, or refinance to a longer term to reduce monthly cash drag",
  vendor_payment: "renegotiate to net-30 with the vendor driving the dip, or split the invoice into two smaller payments",
  customer_payment: "this should be inflow — check why a customer payment landed as outflow",
  income: "this should be inflow — check why income landed as outflow",
  transfer: "this looks like a self-transfer; if you don't want it counted, mark it as transfer in settings",
  other: "review this week's outflows in detail — the biggest items are listed below",
};

function fmtUSD(n: number): string {
  return "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
}

function generateExplanation(week: AtRiskWeek, threshold: number): Explanation {
  const driverList = week.drivers
    .slice(0, 3)
    .map((d) => `${d.description} (~${fmtUSD(d.amount)})`)
    .join(", ");
  const primary = week.drivers[0];
  const actionCategory = primary?.category ?? "other";
  const action = ACTION_BY_CATEGORY[actionCategory];
  const weekDate = new Date(week.week_start + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const explanation =
    `By the week of ${weekDate}, your projected balance falls to about ${fmtUSD(week.projected_balance)} — about ${fmtUSD(week.shortfall)} below your ${fmtUSD(threshold)} floor. ` +
    `The biggest hits this week are ${driverList}. ` +
    `One concrete lever: ${action}.`;
  return {
    week_index: week.week_index,
    explanation,
    cited_transaction_ids: week.drivers.map((d) => d.transaction_id),
  };
}

// ============== generator helpers ==============
type EventConfig = { description: string; amount: number };
type MonthlyEvent = EventConfig & { dayOfMonth: number };
type WeekdayEvent = EventConfig & { weekday: number /* 0..6, 0=Sunday */ };
type DateEvent = EventConfig & { date: string };

interface ScenarioInput {
  id: "agency" | "retail" | "tax-crisis";
  business_name: string;
  bank_account_mask: string;
  starting_balance: number;
  threshold_dollars: number;
  rng_seed: number;
  monthly_inflows: MonthlyEvent[];
  monthly_outflows: MonthlyEvent[];
  weekday_events: WeekdayEvent[]; // weekly cadence by weekday
  biweekly_outflows: { description: string; amount: number; firstDate: string }[];
  quarterly_events: DateEvent[]; // explicit quarterly anchor dates (≥3 to allow quarterly cadence detection)
  annual_events: DateEvent[];
  one_offs: DateEvent[];
}

function generateTxns(input: ScenarioInput): Transaction[] {
  const rng = mulberry32(input.rng_seed);
  const jitter = (cents: number) => Math.round((rng() - 0.5) * cents) / 100;
  const start = addDays(TODAY, -365);
  const txns: Transaction[] = [];
  let counter = 0;
  const push = (date: Date, amount: number, description: string) => {
    counter++;
    const id = `txn_${input.id}_${String(counter).padStart(5, "0")}`;
    txns.push({
      id,
      plaid_transaction_id: `plaid_${id}`,
      date: isoDate(date),
      amount: Math.round(amount * 100) / 100,
      description,
    });
  };

  // monthly events: from 13 months ago through today
  for (let m = -13; m <= 0; m++) {
    const base = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + m, 1));
    for (const ev of input.monthly_inflows) {
      const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), ev.dayOfMonth));
      if (day < start || day > TODAY) continue;
      push(day, ev.amount + jitter(40), ev.description);
    }
    for (const ev of input.monthly_outflows) {
      const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), ev.dayOfMonth));
      if (day < start || day > TODAY) continue;
      push(day, ev.amount, ev.description);
    }
  }

  // weekday-aligned events (weekly cadence, e.g. Stripe Tuesdays)
  for (const ev of input.weekday_events) {
    let d = new Date(start);
    while (d.getUTCDay() !== ev.weekday) d = addDays(d, 1);
    while (d <= TODAY) {
      const amt = ev.amount + jitter(Math.abs(ev.amount) * 0.3);
      push(d, amt, ev.description);
      d = addDays(d, 7);
    }
  }

  // biweekly outflows (payroll-style)
  for (const ev of input.biweekly_outflows) {
    let d = new Date(ev.firstDate + "T12:00:00Z");
    while (d <= TODAY) {
      push(d, ev.amount + jitter(60), ev.description);
      d = addDays(d, 14);
    }
  }

  // explicit quarterly / annual / one-offs
  for (const ev of input.quarterly_events) {
    push(new Date(ev.date + "T12:00:00Z"), ev.amount, ev.description);
  }
  for (const ev of input.annual_events) {
    push(new Date(ev.date + "T12:00:00Z"), ev.amount, ev.description);
  }
  for (const ev of input.one_offs) {
    push(new Date(ev.date + "T12:00:00Z"), ev.amount, ev.description);
  }

  txns.sort((a, b) => (a.date < b.date ? -1 : 1));
  // re-id to keep ids stable across runs
  txns.forEach((t, i) => {
    const id = `txn_${input.id}_${String(i + 1).padStart(5, "0")}`;
    t.id = id;
    t.plaid_transaction_id = `plaid_${id}`;
  });
  return txns;
}

interface ScenarioBundle {
  meta: {
    id: string;
    label: string;
    description: string;
    business_name: string;
    bank_account_mask: string;
    starting_balance: number;
    today: string;
    threshold_dollars: number;
    generated_at: string;
  };
  transactions: CategorizedTransaction[];
  forecast: ForecastResult;
  explanations: Explanation[];
}

function buildScenario(
  input: ScenarioInput,
  meta: { label: string; description: string }
): ScenarioBundle {
  const rawTxns = generateTxns(input);
  const cats = rawTxns.map(categorize);
  const forecast = buildForecast({
    transactions: cats,
    starting_balance: input.starting_balance,
    threshold_dollars: input.threshold_dollars,
    today: isoDate(TODAY),
    business_name: input.business_name,
  });
  const explanations = forecast.at_risk_weeks.map((w) =>
    generateExplanation(w, input.threshold_dollars)
  );
  return {
    meta: {
      id: input.id,
      label: meta.label,
      description: meta.description,
      business_name: input.business_name,
      bank_account_mask: input.bank_account_mask,
      starting_balance: input.starting_balance,
      today: isoDate(TODAY),
      threshold_dollars: input.threshold_dollars,
      generated_at: new Date().toISOString(),
    },
    transactions: cats,
    forecast,
    explanations,
  };
}

// ============== three scenario configs ==============

// ---------- AGENCY: lumpy retainer flow ----------
const AGENCY: ScenarioInput = {
  id: "agency",
  business_name: "Brightline Studio LLC",
  bank_account_mask: "*** 4412 (Chase Business Checking)",
  starting_balance: 7_550,
  threshold_dollars: 5_000,
  rng_seed: 13_13_13,
  monthly_inflows: [
    { description: "ATLAS PARTNERS RETAINER MONTHLY", amount: 28_000, dayOfMonth: 1 },
    { description: "NEXUS BRANDS RETAINER ACH", amount: 18_000, dayOfMonth: 5 },
    { description: "MERIDIAN HEALTH MKTG RETAINER", amount: 14_000, dayOfMonth: 10 },
    { description: "CEDAR HARBOR LAW MO RETAINER", amount: 9_500, dayOfMonth: 15 },
  ],
  monthly_outflows: [
    { description: "WESTLAKE PROPERTIES RENT", amount: -6_500, dayOfMonth: 1 },
    { description: "ANTHEM BCBS GROUP HEALTH", amount: -4_800, dayOfMonth: 2 },
    { description: "HISCOX BUSINESS INSURANCE", amount: -385, dayOfMonth: 3 },
    { description: "CHASE SBL LOAN PMT", amount: -2_150, dayOfMonth: 4 },
    { description: "HUBSPOT MONTHLY", amount: -890, dayOfMonth: 7 },
    { description: "AWS MONTHLY USAGE", amount: -620, dayOfMonth: 8 },
    { description: "FIGMA TEAM SUBSCRIPTION", amount: -480, dayOfMonth: 9 },
    { description: "ZOOM US PRO", amount: -149, dayOfMonth: 11 },
    { description: "AT&T BUSINESS WIRELESS", amount: -312, dayOfMonth: 12 },
    { description: "VERIZON BUSINESS FIBER", amount: -189, dayOfMonth: 13 },
    { description: "SLACK MONTHLY", amount: -228, dayOfMonth: 14 },
    { description: "GOOGLE WORKSPACE", amount: -144, dayOfMonth: 15 },
    { description: "FIDELITY 401K CONTRIB", amount: -1_500, dayOfMonth: 15 },
    { description: "NOTION TEAM", amount: -96, dayOfMonth: 18 },
    { description: "CON ED ELECTRIC", amount: -420, dayOfMonth: 20 },
    { description: "LINEAR APP TEAM", amount: -260, dayOfMonth: 22 },
    { description: "GITHUB TEAM", amount: -75, dayOfMonth: 25 },
  ],
  weekday_events: [{ description: "STRIPE PAYOUT", amount: 2_600, weekday: 2 }],
  biweekly_outflows: [
    { description: "GUSTO PAYROLL BIWEEKLY", amount: -22_400, firstDate: "2025-05-02" },
  ],
  quarterly_events: [
    { description: "ADOBE CC ANNUAL CONTRACT QTR", amount: -5_640, date: "2025-06-05" },
    { description: "ADOBE CC ANNUAL CONTRACT QTR", amount: -5_640, date: "2025-09-05" },
    { description: "ADOBE CC ANNUAL CONTRACT QTR", amount: -5_640, date: "2025-12-05" },
    { description: "ADOBE CC ANNUAL CONTRACT QTR", amount: -5_640, date: "2026-03-05" },
    { description: "NYS SALES TAX QTR", amount: -4_200, date: "2025-06-01" },
    { description: "NYS SALES TAX QTR", amount: -4_200, date: "2025-09-01" },
    { description: "NYS SALES TAX QTR", amount: -4_200, date: "2025-12-01" },
    { description: "NYS SALES TAX QTR", amount: -4_200, date: "2026-03-01" },
    { description: "IRS USATAXPYMT EST Q", amount: -24_500, date: "2025-06-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -24_500, date: "2025-09-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -24_500, date: "2026-01-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -24_500, date: "2026-04-15" },
  ],
  annual_events: [
    { description: "ZURICH GENERAL LIAB ANNUAL", amount: -7_800, date: "2025-06-03" },
  ],
  one_offs: [
    { description: "RIVERSIDE MFG WEBSITE BUILD INV-2041", amount: 22_500, date: "2025-06-12" },
    { description: "VALOR CO PROJECT INVOICE INV-2107", amount: 35_000, date: "2025-09-08" },
    { description: "PINEHURST DESIGN SPRINT INV-2188", amount: 14_750, date: "2025-11-20" },
    { description: "VALOR CO PHASE 2 INV-2274", amount: 28_400, date: "2026-02-18" },
    { description: "OAKMONT CONSULTING INV-2310", amount: 11_200, date: "2026-03-25" },
  ],
};

// ---------- RETAIL: high volume, tight margins ----------
const RETAIL: ScenarioInput = {
  id: "retail",
  business_name: "Goldenwave Goods Co.",
  bank_account_mask: "*** 8821 (Mercury Business Checking)",
  starting_balance: 2_400,
  threshold_dollars: 5_000,
  rng_seed: 27_27_27,
  monthly_inflows: [],
  monthly_outflows: [
    { description: "SOUTHPORT RETAIL RENT", amount: -4_200, dayOfMonth: 1 },
    { description: "ANTHEM BCBS GROUP HEALTH", amount: -3_100, dayOfMonth: 2 },
    { description: "SHOPIFY ADVANCED PLAN", amount: -399, dayOfMonth: 3 },
    { description: "KLAVIYO MARKETING", amount: -540, dayOfMonth: 4 },
    { description: "QUICKBOOKS ONLINE PLUS", amount: -90, dayOfMonth: 5 },
    { description: "HISCOX BUSINESS INSURANCE", amount: -245, dayOfMonth: 6 },
    { description: "COMCAST BUSINESS INTERNET", amount: -279, dayOfMonth: 9 },
    { description: "CON ED ELECTRIC", amount: -680, dayOfMonth: 12 },
    { description: "ADP RUN PAYROLL FEE", amount: -180, dayOfMonth: 13 },
    { description: "MAILCHIMP", amount: -149, dayOfMonth: 14 },
    { description: "AT&T BUSINESS WIRELESS", amount: -240, dayOfMonth: 17 },
    { description: "GOOGLE WORKSPACE", amount: -72, dayOfMonth: 18 },
    { description: "SQUARE TERMINAL LEASE", amount: -89, dayOfMonth: 22 },
    { description: "STRIPE FEE MONTHLY", amount: -310, dayOfMonth: 28 },
  ],
  // Note: cadence detection canonicalizes by description, so multiple events
  // per week with the same description merge into one stream with 1-day gaps
  // (irregular → not projected). One event per merchant per week keeps each
  // stream cleanly weekly. Amounts are scaled to reflect the daily reality.
  weekday_events: [
    { description: "STRIPE PAYOUT", amount: 7_400, weekday: 5 },         // Fri weekly settlement
    { description: "SQUARE PAYOUT", amount: 2_800, weekday: 3 },          // Wed weekly settlement
    { description: "SHOPIFY PAYOUTS", amount: 720, weekday: 4 },          // Thu weekly settlement
    { description: "FAIRE WHOLESALE INVENTORY", amount: -3_600, weekday: 2 },
    { description: "ALIBABA SUPPLIER WIRE", amount: -2_400, weekday: 4 },
    { description: "UPS FREIGHT INBOUND", amount: -380, weekday: 4 },
  ],
  biweekly_outflows: [
    { description: "ADP PAYROLL HOURLY", amount: -13_400, firstDate: "2025-05-09" },
  ],
  quarterly_events: [
    { description: "NYS SALES TAX QTR", amount: -7_200, date: "2025-06-01" },
    { description: "NYS SALES TAX QTR", amount: -7_400, date: "2025-09-01" },
    { description: "NYS SALES TAX QTR", amount: -8_100, date: "2025-12-01" },
    { description: "NYS SALES TAX QTR", amount: -7_900, date: "2026-03-01" },
    { description: "FRANCHISE TAX BOARD", amount: -800, date: "2025-06-15" },
    { description: "FRANCHISE TAX BOARD", amount: -800, date: "2025-09-15" },
    { description: "FRANCHISE TAX BOARD", amount: -800, date: "2026-01-15" },
    { description: "FRANCHISE TAX BOARD", amount: -800, date: "2026-04-15" },
  ],
  annual_events: [],
  one_offs: [
    { description: "HOLIDAY POP-UP DEPOSIT REFUND", amount: 4_200, date: "2025-12-30" },
    { description: "POS HARDWARE UPGRADE", amount: -2_900, date: "2025-08-14" },
    { description: "SHOP RENOVATION CONTRACTOR", amount: -6_400, date: "2025-10-22" },
    { description: "TAX CPA YEAR-END FILING", amount: -1_650, date: "2026-03-15" },
  ],
};

// ---------- TAX CRISIS: massive incoming Q tax ----------
const TAX_CRISIS: ScenarioInput = {
  id: "tax-crisis",
  business_name: "Mariner Builders LLC",
  bank_account_mask: "*** 6034 (Wells Fargo Business)",
  starting_balance: 22_400,
  threshold_dollars: 10_000,
  rng_seed: 41_41_41,
  monthly_inflows: [
    { description: "HARBOR DEVELOPMENT MILESTONE", amount: 18_000, dayOfMonth: 8 },
    { description: "PIER 9 PROGRESS DRAW", amount: 14_500, dayOfMonth: 22 },
  ],
  monthly_outflows: [
    { description: "INDUSTRIAL PARK YARD RENT", amount: -5_400, dayOfMonth: 1 },
    { description: "ANTHEM BCBS GROUP HEALTH", amount: -3_900, dayOfMonth: 2 },
    { description: "EQUIPMENT FINANCING PMT", amount: -3_650, dayOfMonth: 5 },
    { description: "VEHICLE LEASE FORD F-250", amount: -780, dayOfMonth: 6 },
    { description: "VERIZON BUSINESS WIRELESS", amount: -420, dayOfMonth: 9 },
    { description: "QUICKBOOKS ONLINE PLUS", amount: -90, dayOfMonth: 11 },
    { description: "HISCOX GENERAL LIABILITY", amount: -610, dayOfMonth: 14 },
    { description: "CON ED ELECTRIC", amount: -380, dayOfMonth: 19 },
    { description: "FUEL CARD WEX", amount: -1_240, dayOfMonth: 25 },
  ],
  weekday_events: [
    { description: "PROGRESS DRAW WEEKLY", amount: 4_200, weekday: 4 },
  ],
  biweekly_outflows: [
    { description: "GUSTO PAYROLL CREW", amount: -14_800, firstDate: "2025-05-09" },
  ],
  // Consistent $42K IRS payments so cadence detector projects $42K forward.
  // The "crisis" lands in week 12 when the detected next quarterly hits.
  quarterly_events: [
    { description: "IRS USATAXPYMT EST Q", amount: -42_000, date: "2025-06-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -42_000, date: "2025-09-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -42_000, date: "2026-01-15" },
    { description: "IRS USATAXPYMT EST Q", amount: -42_000, date: "2026-04-15" },
    { description: "STATE FRANCHISE TAX", amount: -1_200, date: "2025-06-01" },
    { description: "STATE FRANCHISE TAX", amount: -1_200, date: "2025-09-01" },
    { description: "STATE FRANCHISE TAX", amount: -1_200, date: "2025-12-01" },
    { description: "STATE FRANCHISE TAX", amount: -1_200, date: "2026-03-01" },
  ],
  annual_events: [
    { description: "WORKERS COMP ANNUAL PREMIUM", amount: -9_400, date: "2025-08-12" },
  ],
  one_offs: [
    { description: "PRIME CONTRACTOR PAYMENT", amount: 28_500, date: "2025-07-18" },
    { description: "BAYSIDE OFFICE BUILD INV-1102", amount: 41_000, date: "2025-11-04" },
    { description: "PRIME CONTRACTOR PAYMENT", amount: 31_500, date: "2026-02-12" },
    { description: "STEEL ORDER LEHMANN METALS", amount: -14_600, date: "2025-09-29" },
    { description: "CONCRETE SUPPLIER ALPINE", amount: -8_300, date: "2026-01-20" },
  ],
};

// ============== run ==============
function main() {
  const scenarios: Array<{ input: ScenarioInput; meta: { label: string; description: string } }> = [
    {
      input: AGENCY,
      meta: {
        label: "Agency",
        description:
          "Brightline Studio — 12-person creative agency. Lumpy retainer flow with biweekly payroll and a tight first-of-month convergence.",
      },
    },
    {
      input: RETAIL,
      meta: {
        label: "Retail",
        description:
          "Goldenwave Goods — high-volume online + brick-and-mortar gift shop. Daily Stripe + Square payouts, weekly inventory burn, tight margins.",
      },
    },
    {
      input: TAX_CRISIS,
      meta: {
        label: "Tax Crisis",
        description:
          "Mariner Builders — small construction firm. Healthy ops cash, but a massive $42K Q1 federal true-up lands mid-forecast and hollows out the runway.",
      },
    },
  ];

  const outDir = path.resolve(process.cwd(), "data/scenarios");
  mkdirSync(outDir, { recursive: true });

  const summary: Array<{ id: string; txns: number; at_risk_weeks: number; ending_base: number }> = [];

  for (const s of scenarios) {
    const bundle = buildScenario(s.input, s.meta);
    writeFileSync(
      path.join(outDir, `${s.input.id}.json`),
      JSON.stringify(bundle, null, 2)
    );
    const ending = bundle.forecast.scenarios.base.weeks[12].projected_balance;
    summary.push({
      id: s.input.id,
      txns: bundle.transactions.length,
      at_risk_weeks: bundle.forecast.at_risk_weeks.length,
      ending_base: Math.round(ending),
    });
  }

  console.log("Wrote scenarios:");
  for (const s of summary) {
    console.log(
      `  ${s.id.padEnd(12)}  ${String(s.txns).padStart(4)} txns  ` +
        `${s.at_risk_weeks} at-risk weeks  ending base ${"$" + s.ending_base.toLocaleString()}`
    );
  }
}

main();
