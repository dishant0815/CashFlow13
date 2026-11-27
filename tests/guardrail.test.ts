import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCitations, extractCitedPhrases } from "../lib/guardrail";
import type { Explanation, Transaction } from "../lib/types";

const transactions: Pick<Transaction, "id" | "description">[] = [
  { id: "t1", description: "WESTLAKE PROPERTIES RENT" },
  { id: "t2", description: "GUSTO PAYROLL 4471" },
];

describe("extractCitedPhrases", () => {
  it("pulls ALL-CAPS vendor phrases and ignores normal prose", () => {
    expect(
      extractCitedPhrases("Week 4 dips because WESTLAKE PROPERTIES RENT lands with payroll.")
    ).toEqual(["WESTLAKE PROPERTIES RENT"]);
  });
});

describe("checkCitations", () => {
  it("passes an explanation that only names real transactions", () => {
    const e: Explanation[] = [
      { week_index: 3, explanation: "GUSTO PAYROLL and WESTLAKE PROPERTIES RENT both hit.", cited_transaction_ids: ["t1", "t2"] },
    ];
    expect(checkCitations(e, transactions)).toEqual([]);
  });

  it("rejects a vendor name that is not in the data", () => {
    const e: Explanation[] = [
      { week_index: 5, explanation: "A large ACME LOGISTICS invoice is due.", cited_transaction_ids: ["t1"] },
    ];
    expect(checkCitations(e, transactions)).toEqual([
      { week_index: 5, kind: "uncited_phrase", value: "ACME LOGISTICS" },
    ]);
  });

  it("rejects a cited transaction id that does not exist", () => {
    const e: Explanation[] = [
      { week_index: 2, explanation: "Rent is due.", cited_transaction_ids: ["t99"] },
    ];
    expect(checkCitations(e, transactions)).toEqual([
      { week_index: 2, kind: "unknown_transaction_id", value: "t99" },
    ]);
  });
});

describe("shipped scenario bundles", () => {
  it.each(["agency", "retail", "tax-crisis"])("%s passes the guardrail", (id) => {
    const bundle = JSON.parse(
      readFileSync(path.resolve(__dirname, "../data/scenarios", `${id}.json`), "utf8")
    ) as { transactions: Transaction[]; explanations: Explanation[] };
    expect(checkCitations(bundle.explanations, bundle.transactions)).toEqual([]);
  });
});
