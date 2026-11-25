// lib/guardrail.ts
//
// Citation guardrail for at-risk-week explanations.
//
// An explanation may only name transactions that exist in the input data.
// Two checks, both must pass:
//   1. Every id in `cited_transaction_ids` resolves to a real transaction.
//   2. Every ALL-CAPS phrase in the explanation text (how bank descriptions
//      appear, e.g. "WESTLAKE PROPERTIES RENT") is a substring of at least
//      one real transaction description.
//
// Today's explanations are template-generated from forecast drivers (see
// scripts/seed-scenarios.ts), so they should always pass. The check exists
// so that any future change — a template edit, a hand-tuned bundle, or an
// LLM-written explanation — cannot ship a vendor name that isn't in the data.
//
// Pure TypeScript, no runtime dependencies.

import type { Explanation, Transaction } from "./types";

/** Phrases of 6+ chars made of capitals, digits, '&' and spaces. */
const CITATION_PATTERN = /\b[A-Z][A-Z0-9& ]{4,}[A-Z0-9]\b/g;

export interface CitationFailure {
  week_index: number;
  kind: "unknown_transaction_id" | "uncited_phrase";
  value: string;
}

export function extractCitedPhrases(text: string): string[] {
  return Array.from(text.matchAll(CITATION_PATTERN), (m) => m[0].trim());
}

export function checkCitations(
  explanations: Explanation[],
  transactions: Pick<Transaction, "id" | "description">[]
): CitationFailure[] {
  const ids = new Set(transactions.map((t) => t.id));
  const descriptions = transactions.map((t) => t.description);
  const failures: CitationFailure[] = [];

  for (const e of explanations) {
    for (const id of e.cited_transaction_ids) {
      if (!ids.has(id)) {
        failures.push({ week_index: e.week_index, kind: "unknown_transaction_id", value: id });
      }
    }
    for (const phrase of extractCitedPhrases(e.explanation)) {
      if (!descriptions.some((d) => d.includes(phrase))) {
        failures.push({ week_index: e.week_index, kind: "uncited_phrase", value: phrase });
      }
    }
  }
  return failures;
}

export function formatFailures(failures: CitationFailure[]): string {
  return [
    "CITATION GUARDRAIL FAILED:",
    ...failures.map((f) =>
      f.kind === "unknown_transaction_id"
        ? `  week ${f.week_index}: cited transaction id "${f.value}" does not exist`
        : `  week ${f.week_index}: cited "${f.value}" not found in any transaction`
    ),
  ].join("\n");
}
