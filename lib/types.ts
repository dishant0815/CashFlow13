// Shared types for CashFlow13.

export type Category =
  | "income"
  | "payroll"
  | "rent_or_mortgage"
  | "utilities"
  | "subscriptions"
  | "loan_payment"
  | "tax"
  | "vendor_payment"
  | "customer_payment"
  | "transfer"
  | "other";

export type Cadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "irregular";

export interface Transaction {
  id: string;
  plaid_transaction_id: string;
  date: string; // YYYY-MM-DD
  amount: number; // positive = inflow, negative = outflow
  description: string;
}

export interface CategorizedTransaction extends Transaction {
  category: Category;
  is_recurring: boolean;
  confidence: number; // 0..1
}

export interface RecurringStream {
  description_key: string; // canonicalized merchant key
  representative_description: string;
  category: Category;
  cadence: Cadence;
  avg_amount: number; // average per occurrence; sign preserved
  last_seen: string; // YYYY-MM-DD
  occurrences: number;
  cadence_days: number; // median gap in days
}

export type ScenarioName = "optimistic" | "base" | "pessimistic";

export interface WeekSnapshot {
  week_index: number; // 1..13
  week_start: string; // YYYY-MM-DD (Monday)
  week_end: string; // YYYY-MM-DD (Sunday)
  inflow_total: number;
  outflow_total: number; // positive number
  projected_balance: number; // end-of-week
  top_inflows: Array<{ description: string; amount: number }>;
  top_outflows: Array<{ description: string; amount: number }>;
}

export interface ScenarioForecast {
  scenario: ScenarioName;
  starting_balance: number;
  weeks: WeekSnapshot[];
}

export interface ForecastResult {
  generated_at: string;
  business_name: string;
  starting_balance: number;
  threshold_dollars: number;
  scenarios: Record<ScenarioName, ScenarioForecast>;
  at_risk_weeks: AtRiskWeek[]; // computed against base scenario
}

export interface AtRiskWeek {
  week_index: number;
  week_start: string;
  week_end: string;
  projected_balance: number;
  shortfall: number; // threshold - balance (positive)
  drivers: Array<{
    transaction_id: string;
    description: string;
    amount: number;
    category: Category;
  }>;
}

export interface Explanation {
  week_index: number;
  explanation: string;
  cited_transaction_ids: string[];
}
