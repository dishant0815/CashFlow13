// lib/scenarios.ts
//
// Loads pre-computed scenario bundles from data/scenarios/*.json (generated
// by `node --experimental-strip-types scripts/seed-scenarios.ts`).
// Server-side import only — uses node:fs.

import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  CategorizedTransaction,
  Explanation,
  ForecastResult,
} from "./types";

export type ScenarioId = "agency" | "retail" | "tax-crisis";

export interface ScenarioBundle {
  meta: {
    id: ScenarioId;
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

const ORDER: ScenarioId[] = ["agency", "retail", "tax-crisis"];

export function loadAllScenarios(): Record<ScenarioId, ScenarioBundle> {
  const dir = path.resolve(process.cwd(), "data/scenarios");
  const out = {} as Record<ScenarioId, ScenarioBundle>;
  for (const id of ORDER) {
    const raw = readFileSync(path.join(dir, `${id}.json`), "utf8");
    out[id] = JSON.parse(raw) as ScenarioBundle;
  }
  return out;
}

export const SCENARIO_ORDER = ORDER;
