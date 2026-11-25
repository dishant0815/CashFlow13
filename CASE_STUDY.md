# CashFlow13 — Case Study

A 13-week rolling cash-flow forecast for small businesses, with a plain-English explanation of every at-risk week that cites the transactions behind it.

**Live demo:** [cash-flow13.vercel.app](https://cash-flow13.vercel.app)
**Source:** [README](./README.md) · [ROADMAP](./ROADMAP.md)

> Portfolio project on mock data. The businesses, transactions and results below come from generated demo scenarios, not real users.

---

## Process

I built CashFlow13 to practice product management on a problem with a clear buyer: owner-operated service and retail businesses with no CFO and no forward-looking cash view. The tool larger finance teams use for this — a 13-week rolling forecast — is rarely available in a form a busy owner can read in two minutes.

I treated it as an MVP exercise. The cuts I made on purpose: no accounts, no persistence, no multi-bank aggregation, no editing of categories, no notifications, no phone layout (phones get a "view on desktop" screen). Each one would cost time without changing the core question the demo answers: *is a forecast plus a plain-English "why" useful?*

**The biggest scoping call: a real front door with pre-computed data behind it.** The full live pipeline (Plaid transaction sync, then categorization, then explanations) could run past Vercel's free-tier function limit, and a reviewer who hits a timeout in a 90-second scan sees a broken product. So the *Connect bank* button opens the real Plaid sandbox login when keys are set, and then the app loads a pre-computed mock scenario. The UI says so, and so does this document.

**Projection: conservative over aggressive.** An aggressive engine extrapolates everything — one-time spikes, single annual premiums, irregular contractor payments — and catches more real obligations but also warns about bills that never arrive. A conservative engine only projects streams with enough history. **I shipped conservative.** In a finance tool, a false alarm costs trust that's hard to win back; a missed irregular payment can be covered later by letting the owner add known upcoming bills.

**Explanations: templates first, LLM later.** The worst failure for this product is an explanation that confidently names a bill the owner doesn't have. Today's explanations are generated from a template that copies each at-risk week's top outflows straight from the data, so they can't invent a vendor. A citation guardrail (`lib/guardrail.ts`) enforces the rule anyway, so that a future LLM-written version is held to the same standard. Categorization is a deterministic rule list for the same reason; an LLM categorizer for messy merchant names is on the roadmap.

## Usage

1. Open the demo. It loads the **Agency** scenario ("Brightline Studio LLC", a fictional creative agency).
2. The chart shows three lines (optimistic / base / pessimistic) over 13 weeks; red dots mark weeks below the $5,000 default threshold.
3. In **At-risk weeks**, click *Why is this happening?* on Week 1. The explanation names GUSTO PAYROLL BIWEEKLY, WESTLAKE PROPERTIES RENT and ANTHEM BCBS GROUP HEALTH, lists their amounts, and suggests one action.
4. Drag the **Safety threshold** slider up; more weeks turn red and the list updates instantly.
5. Switch the **Scenario** dropdown to *Retail* or *Tax Crisis* to see different cash-flow patterns.

Local setup is in the [README](./README.md#5-run-it-locally).

## Effects (measured on the eval set and mock data)

**Forecast accuracy.** `npm run eval` runs six hand-built cases with known ground truth — five covering common cadences, one (`case-06-calendar-anchored-tax-HARD`) built to expose a known weakness. Result: **94.9% of weeks within ±$200** (74/78), weighted MAE $435.90, passing the ≥90% bar. This tests whether the math is right for known patterns, not how accurate the forecast would be against real bank accounts — that needs back-testing on real data.

**Honest negative result — quarterly tax lands a month late.** Case 6 fails on its own: 9/13 weeks within tolerance, MAE $2,615, max error $8,500. IRS estimated taxes are due on fixed calendar dates, but the engine models the stream as "every ~91 days", so it projects the next payment about a month after it's really due. The fix — snap tax streams to their calendar due dates — is the top item in the roadmap. I left the failing case in the eval because hiding it would make the headline number less honest.

**Citation guardrail.** `npm run verify:citations` checks every explanation in the three shipped scenarios: each cited transaction id must exist, and each ALL-CAPS vendor phrase must appear in a real transaction description. All three bundles pass; changing one vendor name in an explanation makes the command fail.

**Instrumentation.** A small `track()` shim logs product events (`page_loaded`, `connect_bank_clicked`, `connect_bank_completed`, `forecast_viewed`, `threshold_changed`, `scenario_switched`, `at_risk_explanation_opened`, `feedback_submitted`) to the console and as browser events, ready to forward to an analytics tool. No usage data has been collected.

## Areas for improvement

**Next:** fix calendar-anchored tax dates; add unit tests and a CI workflow so the eval and guardrail run on every push; let the owner add a known upcoming bill or invoice.

**Later:** an LLM-written explanation behind the existing citation guardrail; an LLM categorizer for messy merchant descriptions with the rule list as fallback; a weekly digest so the forecast comes to the owner instead of the owner remembering to open it.

**A design question I'd test first with real owners:** whether the optimistic line earns its space. My hypothesis is that owners plan around the base and pessimistic cases and that a single "what if I close one more deal worth $X" lever would be more useful than a third line. That's an assumption to validate in interviews, not a finding.
