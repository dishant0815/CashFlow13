# CashFlow13 — Operations Guide

How the current build runs, how to deploy and verify it, and how data moves from a mock transaction to a red dot on the chart.

> **What runs today.** The deployed app is a portfolio demo on mock data. All transactions, categories, forecasts and explanations are pre-computed into `data/scenarios/*.json` by `npm run seed` and committed to the repo. The app makes no database or LLM calls. The only server route is `/api/plaid/create-link-token`, used to open the Plaid sandbox login when Plaid keys are configured. Planned integrations (LLM explanations, persistence) are listed in [ROADMAP.md](./ROADMAP.md); a draft database schema is in the appendix.

---

## 1. Setup and deploy

### 1a. Vercel

Import the repo on `vercel.com/new`, accept the Next.js defaults, deploy. **No environment variables are required.** `main` auto-deploys.

### 1b. Plaid sandbox (optional)

Without Plaid keys, clicking *Connect bank* skips the Plaid modal (the link-token route returns an error and `components/PlaidLink.tsx` falls back) and goes straight to the progress animation. To show the real Plaid sandbox login instead:

1. Sign up at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup) → **Team Settings → Keys**. Copy the `client_id` and the **sandbox** secret.
2. Set `PLAID_CLIENT_ID`, `PLAID_SECRET` and `PLAID_ENV=sandbox` in Vercel (**Project → Settings → Environment Variables**) and/or in a local `.env.local` (git-ignored; copy from `.env.example`). Redeploy after changing env vars.
3. In the modal, log in with `user_good` / `pass_good`.

Either way, the Plaid `public_token` is discarded on success: no transactions are fetched, and the dashboard loads the pre-computed **Retail** scenario. This is deliberate — see "Real front door, pre-computed behind it" in the [README](./README.md#4-key-decisions-and-trade-offs).

---

## 2. The data journey

This follows one transaction — the **GUSTO PAYROLL BIWEEKLY** debit in the Agency scenario — from generation to the Week 1 red dot.

### Step 1 — Generate mock transactions

`scripts/seed-scenarios.ts` generates about a year of transactions for each of three fictional businesses from a fixed random seed, so re-running produces the same data (only the `generated_at` timestamps change). Recurring items (retainers, rent, payroll, subscriptions, taxes) are placed on their cadence with small amount jitter; one-off items (equipment, travel, project payments) are scattered in.

### Step 2 — Categorize

The same script labels each transaction with a deterministic rule list (regular expressions on the description), producing `category`, `is_recurring` and `confidence`. `GUSTO PAYROLL BIWEEKLY` matches the payroll rule → `category: "payroll", is_recurring: true`.

### Step 3 — Recurring detection + cadence inference

This is where one categorized transaction becomes part of a *stream*. `lib/forecast.ts → extractRecurringStreams()`:

1. **Group** transactions by canonicalized description key. `canonicalize("GUSTO PAYROLL BIWEEKLY")` strips digits, `INV`/`REF`/`TXN` tokens, and small numeric amounts to get `"GUSTO PAYROLL BIWEEKLY"`. (The same function maps `STRIPE PAYOUT 8847` and `STRIPE PAYOUT 9012` to the same key `"STRIPE PAYOUT"`.)
2. **Compute gaps** between consecutive dates. For Gusto: 14, 14, 14, 14, … (26 occurrences across the year).
3. **Take the median** gap. 14 → matches the `biweekly` window (13-16 days). The stream is tagged `cadence: "biweekly", cadence_days: 14`.
4. **Apply minimum-occurrence guards.** Biweekly requires ≥4 occurrences (Gusto has 26). Annual requires ≥2; quarterly requires ≥3. Single-occurrence streams are *intentionally not projected* — the trade-off is documented in the README and case study.

The Gusto stream now exists with: `{ avg_amount: -22400, cadence: "biweekly", cadence_days: 14, last_seen: "2026-04-17", occurrences: 26 }`.

### Step 4 — 13-week projection

`projectStreams()` walks each stream forward from `last_seen` by `cadence_days` until the date passes today + 91 days (= 13 weeks). For the Gusto stream starting from `2026-04-17`:

```
2026-04-17  ← last_seen (historical, skipped)
2026-05-01  ← projected, lands in Week 1 (Apr 27–May 3)
2026-05-15  ← projected, lands in Week 3
2026-05-29  ← projected, lands in Week 5
2026-06-12  ← projected, lands in Week 7
2026-06-26  ← projected, lands in Week 9
2026-07-10  ← projected, lands in Week 11
2026-07-24  ← projected, lands in Week 13
```

`bucketIntoWeeks()` then takes all projected events from all streams, slots them into 13 weekly buckets keyed by Monday-of-week, and rolls the balance forward starting from `starting_balance`. The Week 1 bucket gets:

- **Inflows:** `ATLAS PARTNERS RETAINER MONTHLY` +$28,000 (May 1), `STRIPE PAYOUT` +$2,600. Total: $30,600.
- **Outflows:** `GUSTO PAYROLL BIWEEKLY` -$22,400 (May 1), `WESTLAKE PROPERTIES RENT` -$6,500 (May 1), `ANTHEM BCBS GROUP HEALTH` -$4,800 (May 2), `HISCOX BUSINESS INSURANCE` -$385 (May 3). Total: $34,085.
- **End-of-week balance:** $7,550 (start) + $30,600 − $34,085 = **$4,065**.

### Step 5 — Three scenarios in parallel

`buildForecast()` runs the bucketing three times: once with the raw amounts (base), once with revenue × 1.10 and costs × 0.95 (optimistic), once with revenue × 0.90 and costs × 1.10 (pessimistic). Each scenario produces its own 13-element `weeks` array. The chart draws three lines from these three arrays.

### Step 6 — At-risk flagging → red dot

`buildForecast()` walks the **base** scenario's 13 weeks. Any week whose `projected_balance < threshold_dollars` becomes an `AtRiskWeek` row with:

- `shortfall = threshold - projected_balance`
- `drivers` = top 3 outflows in that week, mapped back to the most recent historical transaction by description so we can keep a real `transaction_id`.

For Week 1 at the default $5,000 threshold: balance $4,065 < $5,000 → at-risk, shortfall $935, drivers = Gusto / Westlake / Anthem (each pointing to the most recent historical row).

The chart's `BaseDot` component reads the `at_risk` flag on each row and renders a red filled circle with a soft halo when true; otherwise it draws a plain violet dot. **That's the red dot.**

### Step 7 — Plain-English explanation and citation check

For each at-risk week, `generateExplanation()` in the seed script fills a template with the week's projected balance, shortfall, top three outflows (descriptions copied from the data) and one suggested action chosen by the top driver's category. The result for Week 1:

> By the week of April 27, your projected balance falls to about $4,065 — about $935 below your $5,000 floor. The biggest hits this week are GUSTO PAYROLL BIWEEKLY (~$22,400), WESTLAKE PROPERTIES RENT (~$6,500), ANTHEM BCBS GROUP HEALTH (~$4,800). One concrete lever: …

Before the bundle is written, `checkCitations()` in `lib/guardrail.ts` confirms that every cited transaction id exists and that every ALL-CAPS phrase in the text is a substring of a real transaction description. Any miss throws and nothing is written.

In the browser, `components/Dashboard.tsx` re-runs `buildForecast()` whenever the threshold changes. Pre-computed explanations are shown for the weeks they were written for; a week that only becomes at-risk after moving the slider shows its driver transactions without a written explanation.

---

## 3. Commands

```bash
npm run dev                # local dev server
npm run build              # production build (what Vercel runs)
npm run eval               # forecast accuracy harness
npm run verify:citations   # citation guardrail over data/scenarios/*.json
npm run seed               # regenerate data/scenarios/*.json (guardrail runs inside)
```

---

## 4. Verification

### 4a. How to run `npm run eval`

```bash
npm install         # only once
npm run eval
```

You should see output like:

```
CashFlow13 — forecast eval
========================================================================
✓ case-01-rent-and-retainer           MAE $     0.00  max $     0.00  13/13 within $200  (100%)
✓ case-02-biweekly-payroll            MAE $     0.00  max $     0.00  13/13 within $200  (100%)
✓ case-03-quarterly-tax-plus-retainer  MAE $     0.00  max $     0.00  13/13 within $200  (100%)
✓ case-04-multi-stream                MAE $     0.00  max $     0.00  13/13 within $200  (100%)
✓ case-05-mixed-cadences              MAE $     0.00  max $     0.00  13/13 within $200  (100%)
✗ case-06-calendar-anchored-tax-HARD  MAE $  2615.38  max $  8500.00   9/13 within $200  (69.2%)
------------------------------------------------------------------------
OVERALL  weighted MAE $435.90  74/78 weeks within $200  (94.9%)  PASS
```

The runner exits `0` on PASS (≥90% within tolerance) and `1` on FAIL — a CI workflow that runs it on every push is on the roadmap.

The cases live in `eval/cashflow_eval.json` and the runner is `eval/run-eval.ts`. To add a case, append a new entry with a `ground_truth_streams` array. To debug a specific case, edit `eval/run-eval.ts` and add `console.log(predicted.scenarios.base.weeks)` inside `runCase()`.

### 4b. What the output actually tells you

| Metric | What it measures | What "good" looks like | What "bad" looks like |
|---|---|---|---|
| **MAE** (Mean Absolute Error) | Average dollar gap between predicted and ground-truth weekly balance, across all 13 weeks of the case | $0–$200: forecasting math is exact for this case's cadence pattern. $200–$1,000: small projection drift, usually a one-week off-by-one. $1,000+: a cadence the engine got wrong. | $5,000+: an entire stream got missed or projected to the wrong week, and the error compounds through later weeks because the balance roll-forward carries it. |
| **Max error** | The worst single week | Should be ≤ $400 if MAE is ≤ $200 | If max is 10× the MAE, it points to one specific bad week — open `eval/run-eval.ts`, log `errors` for that case, find the index, and look at what stream lands in that week. |
| **% weeks within $200** | Per-case pass rate | ≥90% per case is the bar | Below 90% = the case is exposing a real product limitation. Either fix the engine or document the limitation in CASE_STUDY (we did the latter for case-06). |
| **Weighted MAE (overall)** | Average per-week error across all cases | $0–$500 across the suite | $1,000+ means the engine is systematically wrong on common patterns. |

**What MAE is *not* telling you.** It's not a measurement of forecast accuracy against real banks — that requires backtesting (predict at time T, compare to actual balance at T+13 weeks). The eval set tests *math correctness*, not *world correctness*. Real-world accuracy would need back-testing on real bank data; MAE is the unit-test layer underneath.

**The honest negative metric.** Case 06 fails on purpose: 69.2% within tolerance, MAE $2,615. The IRS quarterly schedule is calendar-anchored (Apr/Jun/Sep/Jan 15), but the engine models the stream as a 91-day median gap, so it projects the next payment ~30 days later than it really lands. The fix (snap tax streams to their calendar due dates) is the top item in [ROADMAP.md](./ROADMAP.md).

### 4c. Verifying the citation guardrail

```bash
npm run verify:citations
```

Expected:

```
✓ agency      2 explanations, 6 cited phrases — all found in source transactions
✓ retail      2 explanations, 6 cited phrases — all found in source transactions
✓ tax-crisis  2 explanations, 3 cited phrases — all found in source transactions
Citation guardrail: PASS
```

To see it fail, change `WESTLAKE PROPERTIES RENT (~` to `WESTPACK PROPERTIES RENT (~` inside an explanation in `data/scenarios/agency.json` and re-run. The command prints `week 1: cited "WESTPACK PROPERTIES RENT" not found in any transaction` and exits with code 1. Revert with `git checkout data/`.

---

## 5. The 90-second demo check

Run this on the live URL after a deploy.

- [ ] Open the URL in a fresh private window on a laptop-size screen. The Agency dashboard renders fully populated, with no spinner or empty state. (Phones see a "view on desktop" screen by design.)
- [ ] **Chart.** Hover the red dot on Week 1: the tooltip shows the week, all three scenario balances, inflow and outflow totals, and "Below threshold".
- [ ] **Explanation.** In *At-risk weeks*, click *Why is this happening?* on Week 1. The paragraph names GUSTO PAYROLL BIWEEKLY, WESTLAKE PROPERTIES RENT and ANTHEM BCBS GROUP HEALTH, with three driver rows below it.
- [ ] **Threshold.** Drag *Safety threshold* up; more weeks turn red and the at-risk count rises. Drag back to $5,000.
- [ ] **Scenarios.** Switch the *Scenario* dropdown to Retail and Tax Crisis; each loads a different business. Toggle the Optimistic chip off and on.
- [ ] **Connect bank.** Click *Connect bank*: the Plaid sandbox modal opens (if keys are set) or the progress animation starts directly; it ends on the Retail scenario with a "Forecast ready" toast and footer text saying it's the pre-computed Retail demo scenario.
- [ ] Open the browser console: interactions print `[track]` lines. Without Plaid keys you will also see one 500 from `/api/plaid/create-link-token`; that is the expected fallback.

### If something is broken

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails while prerendering `/` (ENOENT or JSON error) | A file in `data/scenarios/` is missing or invalid | Run `npm run seed`, commit `data/scenarios/`, push. |
| An at-risk week has no written explanation | The threshold was moved, so the week isn't one the seed script wrote an explanation for | Expected behavior; reset the threshold to the scenario default. |
| `npm run verify:citations` fails | An explanation or template names a vendor not in the data | Fix the template or the bundle, then re-run `npm run seed`. |
| Chart doesn't render | Client-side error | Check the browser console; the dashboard is wrapped in an error boundary that shows a fallback message. |

---

## Appendix: draft persistence schema (designed, not wired up)

Nothing in the current build calls a database. This is the schema drafted for a future version that stores real transactions and forecasts (Supabase Postgres, single user first, ready for Supabase Auth later). It's kept here because it records the data-model decisions — for example, the `UNIQUE` constraint on `plaid_transaction_id` that makes repeated syncs idempotent.

```sql
-- =====================================================================
-- CashFlow13 schema, v1
-- Single-user MVP. user_id columns are stubbed so adding Supabase Auth
-- later is a one-line ALTER TABLE ... ADD CONSTRAINT.
-- =====================================================================

-- Drop in correct order if re-running
drop table if exists public.forecasts cascade;
drop table if exists public.transactions cascade;
drop table if exists public.settings cascade;
drop table if exists public.users cascade;

-- Single fake user for the MVP. Replace with auth.users when you turn on Auth.
create table public.users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  created_at  timestamptz not null default now()
);

-- Insert the hardcoded demo user the seeded build uses.
insert into public.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'demo@cashflow13.app');

-- ---------- transactions ----------
create table public.transactions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  plaid_transaction_id   text not null unique,
  date                   date not null,
  amount                 numeric(14,2) not null,
  description            text not null,
  category               text not null check (category in (
    'income','payroll','rent_or_mortgage','utilities','subscriptions',
    'loan_payment','tax','vendor_payment','customer_payment','transfer','other'
  )),
  is_recurring           boolean not null default false,
  confidence             real not null default 0 check (confidence between 0 and 1),
  created_at             timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_recurring_idx on public.transactions (user_id, is_recurring) where is_recurring = true;

-- ---------- forecasts (one row per /api/forecast run) ----------
create table public.forecasts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  run_at              timestamptz not null default now(),
  threshold_dollars   numeric(14,2) not null,
  weeks_json          jsonb not null,         -- array of 13 WeekSnapshots × 3 scenarios
  at_risk_weeks_json  jsonb not null default '[]'::jsonb
);
create index forecasts_user_run_idx on public.forecasts (user_id, run_at desc);

-- ---------- settings (one row per user) ----------
create table public.settings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.users(id) on delete cascade,
  threshold_dollars   numeric(14,2) not null default 5000,
  updated_at          timestamptz not null default now()
);

-- Seed the demo user's settings row so the dashboard has something to read.
insert into public.settings (user_id, threshold_dollars)
values ('00000000-0000-0000-0000-000000000001', 5000);

-- ---------- Row-Level Security (turn on before going multi-tenant) ----------
-- For the single-user MVP, leave RLS off so the service role can read/write
-- without a JWT. When you add Supabase Auth, run:
--
--   alter table public.transactions enable row level security;
--   create policy "owner reads own txns" on public.transactions
--     for select using (auth.uid() = user_id);
--   -- repeat for forecasts and settings
--
-- For now, RLS stays off. The service role key (NOT the anon key) gates
-- access from the Next.js API routes.
```

After running, sanity-check in **Database → Tables**: you should see `users`, `transactions`, `forecasts`, `settings`, with a single row in `users` and `settings`.

> **Anon key vs. service role key.** The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is safe to ship to the browser; with RLS off, however, **only call Supabase from server-side code** (API routes, Server Components). When you turn RLS on you can move queries to the client.

