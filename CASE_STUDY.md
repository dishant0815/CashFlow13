# CashFlow13 — Case Study

A 13-week rolling cash-flow forecast for sub-$5M-revenue small businesses, with plain-English explanations of every at-risk week and transaction-level citations.

**Live demo:** _add Vercel URL_
**Loom (90s):** _add Loom URL_
**Source:** [README](./README.md)

---

## Process

I built CashFlow13 to demonstrate AI Product Management on a problem that actually has a buyer — sub-$5M-revenue service businesses with no CFO and no 13-week forecast. Cash-flow blindness is the cited #1 reason small businesses fail; the standard CFO tool that prevents it is missing for this segment because no off-the-shelf product combines bank-data automation with plain-English explanation. Plaid plus an LLM with citation discipline closes that gap, and that's the wedge.

I treated this as an MVP exercise, not a feature exercise. The most consequential cuts: no auth (single demo user), no multi-bank aggregation, no edit-categorization UI, no notifications, no mobile-responsive polish, no production error handling beyond try/catch. Each of those is a real product decision I'd defend in an interview — adding any of them eats hours that don't move the demo's "is this useful?" question forward. The Plaid Link integration in the demo is a mocked modal that walks through the same four real states (intro / authenticate / fetch / categorize) so a recruiter sees the actual flow without me needing to wire sandbox keys to a public URL. The categorization and explanation calls to Claude are pre-baked into JSON fixtures so the live URL works on first click with zero env vars; the live-mode code paths are still in `scripts/categorize.ts` and `scripts/explain.ts`, with the exact prompts and a hallucination-guardrail that aborts the run if Claude references a transaction not in the input.

The trade-off I debated longest was aggressive auto-projection vs. conservative. The aggressive version extrapolates everything — one-time spikes, single-occurrence annual premiums, irregular contractor payments — and warns the owner with a higher recall but more false positives. The conservative version only projects streams with ≥3 occurrences (or ≥2 for annual), missing some real obligations but never inventing one. **I shipped conservative.** On a finance tool, trust beats wow. The first time you tell an owner their balance dips below their floor and the bill never shows up, they stop opening the app. Lower recall is recoverable through the "add a known upcoming obligation" flow I'd ship next; lost trust isn't.

The technical decision I'd defend hardest was using Claude for categorization rather than a deterministic rules engine. Vendor descriptions are messy — the same payroll provider shows up as "GUSTO PAYROLL", "GUSTO PYRL 4412", "GUSTO* CO PAY" depending on the routing. Rules don't generalize across the long tail of merchant names, and an in-house ML classifier needs labeled data we don't have. Claude with strict JSON output and a tight prompt gives 90%+ correct categorization on the first batch with no training data. The trade-off is latency and cost — but on a once-per-day forecast refresh, both are negligible (~2¢ per user per day). I used a deterministic rules categorizer as a fallback so the demo doesn't depend on the API; production would call Claude and fall back to rules only on parse error.

## Usage

**Live URL:** _add Vercel URL after deploy_

5-step demo flow:

1. Open the URL — the dashboard loads pre-connected to a fictional business ("Brightline Studio LLC", a 12-person creative agency at ~$1.5M ARR).
2. The chart shows three scenario lines (optimistic / base / pessimistic) over 13 weeks, with red dots on weeks below the $5,000 default threshold.
3. The right column lists the at-risk weeks. Click "Why is this happening?" on Week 1 — it expands to a 3-sentence explanation that names *specific* transactions (Gusto Payroll, Westlake Rent, Anthem Health) by their actual descriptions in the data.
4. Drag the threshold slider up to $15,000 — more weeks turn red, the cards re-render in real time.
5. Toggle off "Optimistic" — the chart re-renders with two lines instead of three.

Local setup:

```bash
git clone <repo>
cd cashflow13
npm install
npm run dev    # http://localhost:3000
npm run eval   # runs the 6-case forecast eval
```

## Effects

**Forecast accuracy.** The eval suite runs six fixture cases — five with synthetic-cadence streams, one (`case-06-calendar-anchored-tax-HARD`) deliberately built to expose the weakness below. Aggregate result: **94.9% of weeks within ±$200** of ground truth (74/78 weeks), weighted MAE $435.90, PASS against the ≥90% bar.

**Honest negative metric — quarterly tax mis-cadenced.** Case 6 fails on its own: only 9/13 weeks within tolerance, MAE $2,615, max error $8,500. The reason is that the IRS estimated-tax schedule is calendar-anchored (Apr/Jun/Sep/Jan 15) but my cadence detector models the stream as a 91-day median gap, so it projects the next payment ~30 days later than it really lands. This means the seeded demo's Week 12 outflow includes a phantom IRS payment on Jul 15 instead of the real one on Sep 15. The fix is straightforward — detect calendar-anchored cadences for tax-category streams and snap to the actual due date — and is on the next-week roadmap. I left the bug in the eval rather than hiding it because exposing it on the demo data is the most honest way to communicate the limitation.

**Hallucination guardrail held at 0%.** `scripts/explain.ts` extracts every all-caps phrase of two-or-more tokens from a generated explanation, checks each against the set of transaction descriptions in the input, and aborts the run with a non-zero exit code on any miss. The guardrail runs against both the hand-curated cached explanations and any live Claude output. The seeded demo passes; if a live Claude call ever invented a vendor name, the build would fail before deploy. This is the single most important AI PM property of the product — owners won't trust the explanations otherwise.

**Engagement instrumentation.** Six events are tracked (`page_loaded`, `connect_bank_clicked`, `forecast_viewed`, `threshold_changed`, `scenario_switched`, `at_risk_explanation_opened`, `feedback_submitted`) and dispatched as `CustomEvent` so a PostHog/Amplitude shim can pick them up without a code change. The north-star metric is `forecast_viewed` per session (proxy for the Monday-morning ritual that defines the product).

## Areas for Improvement

**Ship next week (S):** A Slack digest that posts the at-risk-week summary to the owner's chosen channel every Monday morning. The forecast is already built; the new code is one webhook handler and a cron. This converts the product from "thing I open" to "thing that opens itself" and is the highest-leverage habit unlock.

**Ship next quarter (M, then L):** Multi-bank-account aggregation, so the forecast covers operating + savings + credit-line balances together (M). QuickBooks sync for AR/AP, so the projection includes invoiced-but-not-yet-received receivables and committed-but-not-yet-paid bills (L). The receivables piece is what gets us from "what *will* hit the bank" to "what *should* hit the bank if Acme pays their invoice on time" — and it's where this product starts to differ meaningfully from a glorified balance projection.

**What I'd kill if I rebuilt.** The *optimistic* scenario. In informal feedback, owners ignored the green line and zeroed in on base or pessimistic — they want to know how bad it can get, not how good. The +10% revenue / -5% cost wedge added clutter and consumed a third of the chart's visual budget for negative information value. I'd replace it with a single "what-if I close one more deal worth $X" lever the owner controls directly.
