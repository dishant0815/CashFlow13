/**
 * scripts/verify-citations.ts
 *
 * Runs the citation guardrail (lib/guardrail.ts) over every shipped scenario
 * bundle in data/scenarios/. Exits non-zero if any explanation cites a
 * transaction id or vendor phrase that isn't in that bundle's transactions.
 *
 * Run:  npm run verify:citations
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { checkCitations, extractCitedPhrases, formatFailures } from "../lib/guardrail";
import type { Explanation, Transaction } from "../lib/types";

const IDS = ["agency", "retail", "tax-crisis"];
let failed = false;

for (const id of IDS) {
  const file = path.resolve(process.cwd(), "data/scenarios", `${id}.json`);
  const bundle = JSON.parse(readFileSync(file, "utf8")) as {
    transactions: Transaction[];
    explanations: Explanation[];
  };
  const failures = checkCitations(bundle.explanations, bundle.transactions);
  const phrases = bundle.explanations.reduce(
    (n, e) => n + extractCitedPhrases(e.explanation).length,
    0
  );
  if (failures.length) {
    failed = true;
    console.error(`✗ ${id}`);
    console.error(formatFailures(failures));
  } else {
    console.log(
      `✓ ${id.padEnd(11)} ${bundle.explanations.length} explanations, ${phrases} cited phrases — all found in source transactions`
    );
  }
}

if (failed) process.exit(1);
console.log("Citation guardrail: PASS");
