// lib/forecast.ts
//
// Pure forecasting logic. No I/O, no React, no Next.js — fully unit-testable.
//
// Pipeline:
//   1. Group categorized transactions by canonicalized description key.
//   2. Detect cadence (weekly / biweekly / monthly / quarterly / annual /
//      irregular) by inspecting the median gap between consecutive dates.
//   3. Project each recurring stream forward 13 weeks from the "today" date.
//   4. Bucket projected events into weekly buckets, roll the balance forward.
//   5. Apply scenario multipliers (optimistic / base / pessimistic) on the
//      revenue and cost sides independently.
//
// Deliberate simplifications (documented as known limitations in CASE_STUDY):
//   • One-off non-recurring transactions are NOT projected forward — they only
//     affect history. (Real-world: a known upcoming invoice would need a
//     manual entry path.)
//   • Quarterly cadence detection requires ≥3 occurrences. Annual requires ≥2.
//     Single-occurrence outflows (e.g. an annual liability premium) are
//     intentionally NOT projected — better to under-promise than hallucinate.

import type {
  CategorizedTransaction,
  RecurringStream,
  WeekSnapshot,
  ScenarioForecast,
  ScenarioName,
  ForecastResult,
  AtRiskWeek,
  Cadence,
  Category,
} from "./types";

// ---------- date helpers ----------
export function parseISO(s: string): Date {
  // Treat YYYY-MM-DD as UTC noon to avoid TZ off-by-one issues.
  return new Date(`${s}T12:00:00Z`);
}
export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
/** Monday of the week containing d (UTC). */
export function startOfWeekMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

// ---------- canonicalization ----------
/** Strip volatile parts so we can group "STRIPE PAYOUT 8847" with "STRIPE PAYOUT 9012". */
export function canonicalize(description: string): string {
  return description
    .toUpperCase()
    .replace(/\b(INV|REF|TXN|ID|CONF|AUTH)[-#: ]?[A-Z0-9]+/g, "")
    .replace(/[#*]\s?\d+/g, "")
    .replace(/\d{4,}/g, "") // long digit runs (account numbers, invoice ids)
    .replace(/\b\d{1,3}([.,]\d{2})?\b/g, "") // small numeric amounts
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- cadence detection ----------
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function detectCadence(gapsDays: number[]): { cadence: Cadence; days: number } {
  if (gapsDays.length === 0) return { cadence: "irregular", days: 0 };
  const med = median(gapsDays);
  // Tolerance windows are conservative; if it doesn't fit, mark irregular.
  if (med >= 6 && med <= 8) return { cadence: "weekly", days: 7 };
  if (med >= 13 && med <= 16) return { cadence: "biweekly", days: 14 };
  if (med >= 27 && med <= 33) return { cadence: "monthly", days: 30 };
  if (med >= 85 && med <= 95) return { cadence: "quarterly", days: 91 };
  if (med >= 350 && med <= 380) return { cadence: "annual", days: 365 };
  return { cadence: "irregular", days: Math.round(med) };
}

// ---------- stream extraction ----------
export function extractRecurringStreams(
  txns: CategorizedTransaction[]
): RecurringStream[] {
  const byKey = new Map<string, CategorizedTransaction[]>();
  for (const t of txns) {
    if (!t.is_recurring) continue;
    if (t.category === "transfer") continue;
    const key = canonicalize(t.description);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(t);
  }
  const streams: RecurringStream[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(parseISO(sorted[i - 1].date), parseISO(sorted[i].date)));
    }
    const { cadence, days } = detectCadence(gaps);
    if (cadence === "irregular") continue;
    // Cadence-specific minimum occurrence guards (avoid spurious recurrence).
    if (cadence === "annual" && sorted.length < 2) continue;
    if (cadence === "quarterly" && sorted.length < 3) continue;
    if (cadence === "monthly" && sorted.length < 3) continue;
    if (cadence === "biweekly" && sorted.length < 4) continue;
    if (cadence === "weekly" && sorted.length < 6) continue;

    const avg = sorted.reduce((s, t) => s + t.amount, 0) / sorted.length;
    streams.push({
      description_key: key,
      representative_description: sorted[sorted.length - 1].description,
      category: sorted[sorted.length - 1].category,
      cadence,
      avg_amount: avg,
      last_seen: sorted[sorted.length - 1].date,
      occurrences: sorted.length,
      cadence_days: days,
    });
  }
  return streams;
}

// ---------- projection ----------
interface ProjectedEvent {
  date: string;
  amount: number;
  description: string;
  category: Category;
  source: "recurring";
}

export function projectStreams(
  streams: RecurringStream[],
  todayISO: string,
  weeks: number = 13
): ProjectedEvent[] {
  const today = parseISO(todayISO);
  const horizonEnd = addDays(today, weeks * 7);
  const events: ProjectedEvent[] = [];
  for (const s of streams) {
    let next = addDays(parseISO(s.last_seen), s.cadence_days);
    // Skip past-today catch-ups (those are already historical).
    while (next < today) next = addDays(next, s.cadence_days);
    while (next <= horizonEnd) {
      events.push({
        date: toISO(next),
        amount: Math.round(s.avg_amount * 100) / 100,
        description: s.representative_description,
        category: s.category,
        source: "recurring",
      });
      next = addDays(next, s.cadence_days);
    }
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------- scenario application ----------
const SCENARIO_MULTIPLIERS: Record<ScenarioName, { revenue: number; cost: number }> = {
  optimistic: { revenue: 1.10, cost: 0.95 },
  base: { revenue: 1.00, cost: 1.00 },
  pessimistic: { revenue: 0.90, cost: 1.10 },
};

function applyScenario(events: ProjectedEvent[], scenario: ScenarioName): ProjectedEvent[] {
  const m = SCENARIO_MULTIPLIERS[scenario];
  return events.map((e) => ({
    ...e,
    amount:
      e.amount > 0
        ? Math.round(e.amount * m.revenue * 100) / 100
        : Math.round(e.amount * m.cost * 100) / 100,
  }));
}

// ---------- weekly aggregation ----------
export function bucketIntoWeeks(
  events: ProjectedEvent[],
  todayISO: string,
  startingBalance: number,
  weeks: number = 13
): WeekSnapshot[] {
  const today = parseISO(todayISO);
  // Forecast week 1 starts the day AFTER today.
  const week1Start = addDays(today, 1);

  const out: WeekSnapshot[] = [];
  let balance = startingBalance;
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(week1Start, i * 7);
    const we = addDays(ws, 6);
    const wsISO = toISO(ws);
    const weISO = toISO(we);
    const inWeek = events.filter((e) => e.date >= wsISO && e.date <= weISO);
    const inflow = inWeek.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const outflow = inWeek
      .filter((e) => e.amount < 0)
      .reduce((s, e) => s + Math.abs(e.amount), 0);
    balance = balance + inflow - outflow;
    const top = (sign: 1 | -1) =>
      [...inWeek]
        .filter((e) => Math.sign(e.amount) === sign)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 4)
        .map((e) => ({ description: e.description, amount: e.amount }));
    out.push({
      week_index: i + 1,
      week_start: wsISO,
      week_end: weISO,
      inflow_total: Math.round(inflow * 100) / 100,
      outflow_total: Math.round(outflow * 100) / 100,
      projected_balance: Math.round(balance * 100) / 100,
      top_inflows: top(1),
      top_outflows: top(-1),
    });
  }
  return out;
}

// ---------- top-level orchestration ----------
export function buildForecast(input: {
  transactions: CategorizedTransaction[];
  starting_balance: number;
  threshold_dollars: number;
  today: string;
  business_name: string;
}): ForecastResult {
  const streams = extractRecurringStreams(input.transactions);
  const baseEvents = projectStreams(streams, input.today, 13);

  const scenarios: Record<ScenarioName, ScenarioForecast> = {
    optimistic: {
      scenario: "optimistic",
      starting_balance: input.starting_balance,
      weeks: bucketIntoWeeks(applyScenario(baseEvents, "optimistic"), input.today, input.starting_balance),
    },
    base: {
      scenario: "base",
      starting_balance: input.starting_balance,
      weeks: bucketIntoWeeks(baseEvents, input.today, input.starting_balance),
    },
    pessimistic: {
      scenario: "pessimistic",
      starting_balance: input.starting_balance,
      weeks: bucketIntoWeeks(applyScenario(baseEvents, "pessimistic"), input.today, input.starting_balance),
    },
  };

  // At-risk weeks computed against BASE (the headline forecast). Drivers are
  // the actual recurring transactions in that week — citation discipline
  // depends on these IDs.
  const atRisk: AtRiskWeek[] = [];
  for (const w of scenarios.base.weeks) {
    if (w.projected_balance < input.threshold_dollars) {
      // Drivers = top 3 outflows in this week, mapped back to the most recent
      // historical transaction with that description (so we can cite a real
      // plaid_transaction_id for hallucination-prevention).
      const drivers = w.top_outflows.slice(0, 3).map((o) => {
        const recentMatch = [...input.transactions]
          .filter((t) => t.description === o.description)
          .sort((a, b) => (a.date > b.date ? -1 : 1))[0];
        return {
          transaction_id: recentMatch?.id ?? "unknown",
          description: o.description,
          amount: o.amount,
          category: recentMatch?.category ?? ("other" as Category),
        };
      });
      atRisk.push({
        week_index: w.week_index,
        week_start: w.week_start,
        week_end: w.week_end,
        projected_balance: w.projected_balance,
        shortfall: Math.round((input.threshold_dollars - w.projected_balance) * 100) / 100,
        drivers,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    business_name: input.business_name,
    starting_balance: input.starting_balance,
    threshold_dollars: input.threshold_dollars,
    scenarios,
    at_risk_weeks: atRisk,
  };
}
