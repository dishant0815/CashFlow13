import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketIntoWeeks,
  buildForecast,
  canonicalize,
  detectCadence,
  extractRecurringStreams,
  parseISO,
  projectStreams,
  startOfWeekMonday,
  toISO,
} from "../lib/forecast";
import type { CategorizedTransaction } from "../lib/types";

let seq = 0;
function txn(
  date: string,
  amount: number,
  description: string,
  category: CategorizedTransaction["category"],
  is_recurring = true
): CategorizedTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    plaid_transaction_id: `p${seq}`,
    date,
    amount,
    description,
    category,
    is_recurring,
    confidence: 1,
  };
}

/** n transactions every `gap` days, starting at `start`. */
function series(
  start: string,
  gap: number,
  n: number,
  amount: number,
  description: string,
  category: CategorizedTransaction["category"]
) {
  return Array.from({ length: n }, (_, i) =>
    txn(toISO(addDays(parseISO(start), i * gap)), amount, description, category)
  );
}

describe("date helpers", () => {
  it("round-trips ISO dates without timezone drift", () => {
    expect(toISO(parseISO("2026-03-08"))).toBe("2026-03-08");
  });

  it("finds the Monday of a week, including for Sundays", () => {
    expect(toISO(startOfWeekMonday(parseISO("2026-11-25")))).toBe("2026-11-23"); // Wed
    expect(toISO(startOfWeekMonday(parseISO("2026-11-29")))).toBe("2026-11-23"); // Sun
  });
});

describe("canonicalize", () => {
  it("groups payouts that differ only by reference numbers", () => {
    expect(canonicalize("STRIPE PAYOUT 8847")).toBe(canonicalize("Stripe Payout 9012"));
  });

  it("keeps different vendors apart", () => {
    expect(canonicalize("WESTLAKE PROPERTIES RENT")).not.toBe(canonicalize("GUSTO PAYROLL"));
  });
});

describe("detectCadence", () => {
  it.each([
    [[7, 7, 7], "weekly"],
    [[14, 14, 15], "biweekly"],
    [[31, 28, 31], "monthly"],
    [[91, 92, 90], "quarterly"],
    [[365], "annual"],
    [[3, 40, 11], "irregular"],
    [[], "irregular"],
  ])("gaps %j → %s", (gaps, expected) => {
    expect(detectCadence(gaps as number[]).cadence).toBe(expected);
  });
});

describe("extractRecurringStreams", () => {
  it("finds a monthly rent stream with its average amount", () => {
    const txns = series("2026-06-01", 30, 4, -3000, "WESTLAKE PROPERTIES RENT", "rent_or_mortgage");
    const streams = extractRecurringStreams(txns);
    expect(streams).toHaveLength(1);
    expect(streams[0].cadence).toBe("monthly");
    expect(streams[0].avg_amount).toBe(-3000);
    expect(streams[0].last_seen).toBe(txns[3].date);
  });

  it("ignores transfers and non-recurring transactions", () => {
    const txns = [
      ...series("2026-06-01", 30, 4, -500, "TRANSFER TO SAVINGS", "transfer"),
      ...series("2026-06-01", 30, 4, -80, "ONE OFF SUPPLIES", "other").map((t) => ({
        ...t,
        is_recurring: false,
      })),
    ];
    expect(extractRecurringStreams(txns)).toEqual([]);
  });

  it("does not project a stream with too few occurrences to trust", () => {
    // Two monthly payments are not enough evidence (needs 3).
    const txns = series("2026-08-01", 30, 2, -200, "ADOBE SUBSCRIPTION", "subscriptions");
    expect(extractRecurringStreams(txns)).toEqual([]);
  });
});

describe("projectStreams", () => {
  it("projects a weekly stream forward across the 13-week horizon only", () => {
    const streams = extractRecurringStreams(
      series("2026-09-01", 7, 8, 1000, "STRIPE PAYOUT", "customer_payment")
    );
    const events = projectStreams(streams, "2026-10-20", 13);
    expect(events.length).toBeGreaterThanOrEqual(13);
    expect(events.length).toBeLessThanOrEqual(14);
    expect(events.every((e) => e.date >= "2026-10-20")).toBe(true);
    expect(events.every((e) => e.date <= toISO(addDays(parseISO("2026-10-20"), 91)))).toBe(true);
  });
});

describe("bucketIntoWeeks", () => {
  it("rolls the balance forward week by week", () => {
    const events = [
      { date: "2026-11-02", amount: 500, description: "IN", category: "income" as const, source: "recurring" as const },
      { date: "2026-11-03", amount: -200, description: "OUT", category: "other" as const, source: "recurring" as const },
      { date: "2026-11-10", amount: -1000, description: "OUT", category: "other" as const, source: "recurring" as const },
    ];
    const weeks = bucketIntoWeeks(events, "2026-11-01", 1000, 3);
    expect(weeks.map((w) => w.projected_balance)).toEqual([1300, 300, 300]);
    expect(weeks[0].inflow_total).toBe(500);
    expect(weeks[0].outflow_total).toBe(200);
    expect(weeks[0].week_start).toBe("2026-11-02"); // week 1 starts the day after today
  });
});

describe("buildForecast", () => {
  const today = "2026-11-01";
  const transactions = [
    ...series("2026-06-04", 14, 11, 2500, "STRIPE PAYOUT", "customer_payment"),
    ...series("2026-06-05", 30, 5, -4000, "WESTLAKE PROPERTIES RENT", "rent_or_mortgage"),
  ];
  const input = {
    transactions,
    starting_balance: 3000,
    threshold_dollars: 2000,
    today,
    business_name: "Test Co",
  };

  it("orders scenarios optimistic ≥ base ≥ pessimistic every week", () => {
    const f = buildForecast(input);
    for (let i = 0; i < 13; i++) {
      const o = f.scenarios.optimistic.weeks[i].projected_balance;
      const b = f.scenarios.base.weeks[i].projected_balance;
      const p = f.scenarios.pessimistic.weeks[i].projected_balance;
      expect(o).toBeGreaterThanOrEqual(b);
      expect(b).toBeGreaterThanOrEqual(p);
    }
  });

  it("flags exactly the base-scenario weeks below the threshold", () => {
    const f = buildForecast(input);
    const below = f.scenarios.base.weeks
      .filter((w) => w.projected_balance < input.threshold_dollars)
      .map((w) => w.week_index);
    expect(f.at_risk_weeks.map((w) => w.week_index)).toEqual(below);
    for (const w of f.at_risk_weeks) {
      expect(w.shortfall).toBeCloseTo(input.threshold_dollars - w.projected_balance, 2);
    }
  });

  it("cites a real transaction id for every at-risk driver", () => {
    const f = buildForecast({ ...input, threshold_dollars: 1_000_000 });
    const ids = new Set(transactions.map((t) => t.id));
    expect(f.at_risk_weeks.length).toBe(13);
    for (const w of f.at_risk_weeks) {
      for (const d of w.drivers) expect(ids.has(d.transaction_id)).toBe(true);
    }
  });

  it("flags nothing when the balance never dips below the floor", () => {
    expect(buildForecast({ ...input, threshold_dollars: -1_000_000 }).at_risk_weeks).toEqual([]);
  });
});
