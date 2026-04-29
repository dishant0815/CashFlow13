# CashFlow13 — Deployment & Operations Guide

This is the playbook for taking the seeded MVP from your laptop to a recruiter-ready URL, and the reference for wiring up the live integrations (Plaid + Supabase + Google Gemini Flash) when you're ready to move beyond the demo data.

> **Read this first.** The current build ships as a **seeded demo** — all transactions, categorizations, and explanations live in `data/*.json` and the dashboard reads them at request time. The live integrations described in §1 are *not* required for the public URL to work. Add them only when you're ready to support a real user. Throughout this guide, anything labeled **[Seeded path]** is what you need today; **[Live path]** is what you need later.

---

## 1. The Plumbing Setup (Infrastructure)

### 1a. Supabase

**[Seeded path]** Skip this section entirely. The deployed Vercel build reads from the JSON files in `data/` and never calls Supabase.

**[Live path]** When you wire up the real Plaid round-trip, run the SQL below in the Supabase SQL Editor (Project → SQL → New Query → paste → Run).

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

### 1b. Plaid Sandbox

**[Seeded path]** Not required. The `PlaidMockModal` component in `components/PlaidMockModal.tsx` walks the user through the same four states as the real Plaid Link flow without touching Plaid.

**[Live path]** Three things to do.

**Get your keys.** Sign up at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup), then:

1. **Team Settings → Keys**.
2. You'll see one `client_id` (used everywhere) and three secrets, one per environment:
   - `sandbox_secret` — fake banks, fake transactions, free, unlimited. **This is the one you use for development and for any portfolio demo.**
   - `development_secret` — real banks, capped at 100 connected Items, free. Use this only if you want to wire your *own* real bank account into a personal demo. Don't use it for anything public-facing.
   - `production_secret` — real banks, requires Plaid product review and a signed pricing agreement. Don't worry about this until you have paying customers.
3. Copy the `client_id` and `sandbox_secret` into the Vercel env vars below.

**Set the environment variable.** In your code, the Plaid client picks the right host based on `PLAID_ENV`:

```ts
import { PlaidApi, Configuration, PlaidEnvironments } from "plaid";
const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"],
  baseOptions: { headers: {
    "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
    "PLAID-SECRET":    process.env.PLAID_SECRET,
  }},
}));
```

Set `PLAID_ENV=sandbox` for now. Later, when you want to test against real banks (still free, just capped), flip to `PLAID_ENV=development` *and* swap `PLAID_SECRET` to your `development_secret`. The two changes always travel together — using a sandbox secret against the development host (or vice versa) returns 400s.

**Sandbox login.** When the real Plaid Link modal opens, use credentials `user_good` / `pass_good` and pick "First Platypus Bank". That returns ~30 seeded transactions across two accounts.

### 1c. Google AI Studio (Gemini API key)

**[Seeded path]** Not required. The seeded build never calls Gemini.

**[Live path]** Gemini Flash is the AI brain for both `/api/categorize` and `/api/explain`. The free tier is generous enough to cover a single-user MVP without ever paying a cent.

**Get a free key.**

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with any Google account.
2. Click **Create API key**. Pick "Create API key in new project" if you don't already have a Google Cloud project, or choose an existing one.
3. Copy the key (it starts with `AIza…`). Treat it like a password — paste it into your password manager and into Vercel's env vars below. **Do not commit it.**

**Free-tier limits (gemini-2.5-flash, as of writing).** 10 requests per minute, 250K input tokens per minute, 250 requests per day. CashFlow13 hits Gemini 8 times per categorization run (375 transactions ÷ 50/batch) and 1 time per forecast explanation. A single user clicking the dashboard 100 times a day costs ~9 requests/day. You will not hit the cap.

**Pick a model.** The default is `gemini-2.5-flash`. If you want to swap (e.g. for `gemini-2.0-flash` or `gemini-1.5-flash` if quota changes), set `GEMINI_MODEL` in your env. Both API routes read that variable and fall back to `gemini-2.5-flash`.

**Strict JSON output.** Both API routes pass `responseMimeType: "application/json"` AND a `responseSchema` to Gemini's `generateContent` call. The schema is enforced server-side by Google — Gemini will not emit prose, code fences, or fields outside the schema. This is a meaningfully cleaner contract than Claude's "instructed-not-promised" JSON; we exploit it by parsing the response unconditionally.

### 1d. Vercel

**[Seeded path]** Push to GitHub → import on `vercel.com/new` → accept Next.js defaults → click Deploy. **Skip env vars entirely.** Build takes ~90s, you get a `*.vercel.app` URL.

**[Live path]** Add the env vars below in **Project → Settings → Environment Variables**. Set the **Environment** field to *Production, Preview, and Development* for all of them unless noted.

| Variable | Required when | Where it comes from | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | `/api/categorize` or `/api/explain` are called | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key | Server-side only. Never `NEXT_PUBLIC_`. Free tier covers MVP load. |
| `GEMINI_MODEL` | (optional) | You set this | Defaults to `gemini-2.5-flash`. Set to `gemini-2.0-flash` if you need a higher RPD ceiling. |
| `PLAID_CLIENT_ID` | Real Plaid Link | Plaid dashboard → Team Settings → Keys | Same value across all three Plaid environments. |
| `PLAID_SECRET` | Real Plaid Link | Plaid dashboard → Team Settings → Keys → Sandbox/Development/Production secret | Must match `PLAID_ENV`. |
| `PLAID_ENV` | Real Plaid Link | You set this | `sandbox` for the portfolio demo. |
| `NEXT_PUBLIC_SUPABASE_URL` | Persistence | Supabase project → Settings → API → Project URL | Safe to expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Persistence (client reads) | Supabase project → Settings → API → `anon` `public` key | Safe to expose; gated by RLS once enabled. |
| `SUPABASE_SERVICE_ROLE_KEY` | Persistence (server writes) | Supabase project → Settings → API → `service_role` `secret` key | **Server-side only.** Never `NEXT_PUBLIC_`. Bypasses RLS — leaking this is a P0. |
| `NEXT_PUBLIC_DEMO_USER_ID` | Live mode (single demo user) | The UUID from the `users` insert in §1a (`00000000-0000-0000-0000-000000000001`) | Hardcoded for the MVP; replace with `auth.user().id` when you add Auth. |

After saving env vars, **redeploy** so Vercel picks them up: Deployments → … → Redeploy. There's no automatic redeploy on env var change.

> **Local mirror.** Copy `.env.example` to `.env.local` and fill in the same values for `npm run dev`. `.env.local` is git-ignored.

---

## 2. The Data Journey (Functional Walkthrough)

This is the lifecycle of a single transaction — say, the **GUSTO PAYROLL BIWEEKLY** debit on May 1, 2026 — from the moment the user clicks **Connect Bank** to the moment it pushes the Week 1 dot to red on the chart. The **[Seeded path]** column is what actually happens in today's deployed build; **[Live path]** is what each step turns into when you swap in the real services.

### Step 1 — User clicks "Connect bank"

| | [Seeded path] | [Live path] |
|---|---|---|
| What runs | `PlaidMockModal` opens, fires `connect_bank_clicked` event | `useEffect` calls `/api/plaid/create-link-token` which exchanges your `PLAID_CLIENT_ID`/`PLAID_SECRET` for a one-time `link_token`. The `react-plaid-link` SDK opens the Plaid Link modal in an iframe. |
| What the user sees | A list of fake banks; clicking Chase walks through 4 fake stages | The real Plaid Link UI. User picks bank, enters credentials. |
| What lands in the DB | Nothing | After the user finishes, Plaid posts a `public_token` back to the page; the page POSTs it to `/api/plaid/exchange`, which trades it for a permanent `access_token` and stores `(user_id, access_token, item_id)` in a `plaid_items` table. |

### Step 2 — Pull 365 days of transactions

| | [Seeded path] | [Live path] |
|---|---|---|
| What runs | Nothing — `data/transactions.json` is already on disk, generated by `npm run seed` | `/api/plaid/sync` calls Plaid's `/transactions/sync` endpoint (it's `since` a cursor; for the first call you pass empty cursor and get the full 365-day window). |
| What lands in the DB | Nothing | An `INSERT ... ON CONFLICT (plaid_transaction_id) DO NOTHING` against `public.transactions` for every returned row. The `plaid_transaction_id` unique constraint is what makes incremental syncs idempotent. |

The Gusto payroll debit lands as one row: `{ plaid_transaction_id: "plaid_txn_00369", date: "2026-04-17", amount: -22399.97, description: "GUSTO PAYROLL BIWEEKLY" }`.

### Step 3 — The Categorization Engine decides its label

This is the AI PM core. The decision tree is the same in both paths; only the engine differs.

**[Seeded path]** `scripts/categorize.ts` runs at build time (or once, off-line) with no API key set. It applies the deterministic rule list at the top of that file:

```ts
{ test: /(PAYROLL|GUSTO)/i, category: "payroll", recurring: true, conf: 0.99 }
```

The Gusto debit matches the first rule with `(PAYROLL|GUSTO)` → category `payroll`, `is_recurring: true`, `confidence: 0.99`. Every other row falls through the rule chain in priority order (income before vendor; transfer before generic; etc.) until it matches or hits the `other` fallback at confidence 0.4.

**[Live path]** The browser POSTs the new transactions to `app/api/categorize/route.ts`. That route reads `GEMINI_API_KEY` from the server env, instantiates `new GoogleGenAI({ apiKey })`, splits the input into batches of 50, and fires `Promise.all()` over the batches. Each batch call to Gemini Flash looks like:

```ts
await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: CATEGORIZATION_PROMPT + JSON.stringify(batch),
  config: {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: { /* OpenAPI schema enumerating the 11 categories */ },
  },
});
```

The prompt is the same one specified in the project rules:

> "You are a categorization engine for a small-business cash-flow tool. Given a list of bank transactions, return strict JSON labeling each one. Schema for each item: {id, category (one of: income, payroll, rent_or_mortgage, utilities, subscriptions, loan_payment, tax, vendor_payment, customer_payment, transfer, other), is_recurring (boolean), confidence (0-1)}. Rules: is_recurring is true only if the description suggests a repeating obligation. Transfers between own accounts → category transfer, is_recurring false. If unsure, category 'other' with low confidence. Output ONLY a JSON array. No prose."

Because `responseSchema` is enforced server-side by Google, Gemini cannot emit prose, code fences, or extra fields — `JSON.parse()` is unconditional, no regex stripping required. The route then maps each parsed `{id, category, is_recurring, confidence}` back to the original transaction by id, clamps `confidence` to `[0,1]`, validates `category` against the allowed set (defaulting unknown values to `other`), and `UPSERT`s the rows into `public.transactions` (or returns them in the response when running in stateless mode).

The Gusto row comes back as `{category: "payroll", is_recurring: true, confidence: 0.96}`.

**Why Gemini over rules-only.** Vendor descriptions are messy — the same payroll provider shows up as `GUSTO PAYROLL BIWEEKLY`, `GUSTO PYRL 4412`, `GUSTO* CO PAY` depending on the routing. Rules don't generalize across the long tail. The rules engine ships in this repo as a fallback so the demo doesn't depend on the API; production calls Gemini and falls back to rules only on parse error or quota exhaustion.

**Why Gemini over Claude.** Same correctness on this task in our spot-checks; **free** at MVP scale (10 RPM / 250 RPD on `gemini-2.5-flash`); and `responseSchema` is a hard contract that simplifies error handling versus Claude's instructed-JSON convention. The prompt itself is unchanged from the original spec, so swapping back is a one-file diff.

### Step 4 — Recurring detection + cadence inference

This is where one categorized transaction becomes part of a *stream*. `lib/forecast.ts → extractRecurringStreams()`:

1. **Group** transactions by canonicalized description key. `canonicalize("GUSTO PAYROLL BIWEEKLY")` strips digits, `INV`/`REF`/`TXN` tokens, and small numeric amounts to get `"GUSTO PAYROLL BIWEEKLY"`. (The same function maps `STRIPE PAYOUT 8847` and `STRIPE PAYOUT 9012` to the same key `"STRIPE PAYOUT"`.)
2. **Compute gaps** between consecutive dates. For Gusto: 14, 14, 14, 14, … (26 occurrences across the year).
3. **Take the median** gap. 14 → matches the `biweekly` window (13-16 days). The stream is tagged `cadence: "biweekly", cadence_days: 14`.
4. **Apply minimum-occurrence guards.** Biweekly requires ≥4 occurrences (Gusto has 26). Annual requires ≥2; quarterly requires ≥3. Single-occurrence streams are *intentionally not projected* — the trade-off is documented in the case study.

The Gusto stream now exists with: `{ avg_amount: -22400, cadence: "biweekly", cadence_days: 14, last_seen: "2026-04-17", occurrences: 26 }`.

### Step 5 — 13-week projection

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

- **Inflows:** `ATLAS PARTNERS RETAINER MONTHLY` +$28,000 (May 1), `STRIPE PAYOUT` +$2,787 (Apr 28). Total: $30,787.
- **Outflows:** `GUSTO PAYROLL BIWEEKLY` -$22,400 (May 1), `WESTLAKE PROPERTIES RENT` -$6,500 (May 1), `ANTHEM BCBS GROUP HEALTH` -$4,800 (May 2), `HISCOX BUSINESS INSURANCE` -$385 (May 3). Total: $34,085.
- **End-of-week balance:** $7,550 (start) + $30,787 - $34,085 = **$4,252**.

### Step 6 — Three scenarios in parallel

`buildForecast()` runs the bucketing three times: once with the raw amounts (base), once with revenue × 1.10 and costs × 0.95 (optimistic), once with revenue × 0.90 and costs × 1.10 (pessimistic). Each scenario produces its own 13-element `weeks` array. The chart draws three lines from these three arrays.

### Step 7 — At-risk flagging → red dot

`buildForecast()` walks the **base** scenario's 13 weeks. Any week whose `projected_balance < threshold_dollars` becomes an `AtRiskWeek` row with:

- `shortfall = threshold - projected_balance`
- `drivers` = top 3 outflows in that week, mapped back to the most recent historical transaction by description so we can keep a real `transaction_id`.

For Week 1 at the default $5,000 threshold: balance $4,252 < $5,000 → at-risk, shortfall $748, drivers = Gusto / Westlake / Anthem (each pointing to the most recent historical row).

The chart's `BaseDot` component reads the `at_risk` flag on each row and renders a red filled circle with a soft halo when true; otherwise it draws a plain violet dot. **That's the red dot.**

### Step 8 — Plain-English explanation

Two sub-paths.

**[Seeded path]** `data/explanations.json` was written once by `scripts/explain.ts` from the `HAND_EXPLANATIONS` array in that file. The explanation for Week 1 names Gusto, Westlake, and Anthem by their actual transaction descriptions, and the script's hallucination guardrail confirms each cited phrase appears in `data/transactions.json` before writing the file. The dashboard reads the cached explanation on render.

**[Live path]** The browser POSTs `{ forecast, at_risk_weeks, transactions }` to `app/api/explain/route.ts`. That route slims each payload to only the fields Gemini needs to cite responsibly (id, date, amount, description on the transactions; week_index/start/end/balance/inflow/outflow on the forecast), substitutes them into the prompt template, and calls Gemini Flash:

```ts
await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: prompt,
  config: {
    temperature: 0.4,
    responseMimeType: "application/json",
    responseSchema: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          week: { type: "INTEGER" },
          explanation: { type: "STRING" },
        },
        required: ["week", "explanation"],
      },
    },
  },
});
```

The prompt is the same one from the project rules:

> "You are explaining a cash-flow forecast to a small-business owner. They are not financially trained. Be direct and brief. Forecast JSON: {{FORECAST}}. At-risk weeks: {{AT_RISK}}. For EACH at-risk week write one paragraph (3-4 sentences): state the week and how far below threshold the balance dips; name the 2-3 specific transactions driving the dip using the actual descriptions; suggest one concrete action the owner could take. Tone: a trusted accountant talking to an owner. No jargon. No hallucination — only reference transactions actually in the input. If you can't find supporting transactions, say so. Output: JSON array of {week, explanation}."

Gemini returns one paragraph per at-risk week as a JSON array. Before the route returns, it runs the **hallucination guardrail server-side**: it extracts every all-caps phrase of ≥2 tokens from each explanation and confirms each is a substring of some real transaction description in the input. **If any phrase doesn't match, the route responds 422 with the offending citations and emits zero explanations** — the user sees a "regenerating…" state instead of a wrong-but-confident card. This is the single most important AI PM property of the product — see §3c.

The temperature is bumped to `0.4` for the explanation route (vs `0` for categorization) because the writing tone matters; categorization is a deterministic labeling task and benefits from `0`.

### Step 9 — User clicks "Why is this happening?" and sees the explanation

`AtRiskCard` toggles open, fires `at_risk_explanation_opened` event, renders the cached paragraph, and lists the three driver transactions inline so the user can verify the citations themselves.

That's the full journey: one Plaid row → one categorized DB row → one member of one recurring stream → seven projected events → contributions to seven weekly buckets → one of which trips the threshold → one explanation that names it back by the original description.

---

## 3. Verification & The Eval Set

### 3a. How to run `npm run eval`

```bash
cd ~/CashFlow13
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

The runner exits `0` on PASS (≥90% within tolerance) and `1` on FAIL — wire this into a GitHub Action on PR if you want CI gating.

The cases live in `eval/cashflow_eval.json` and the runner is `eval/run-eval.ts`. To add a case, append a new entry with a `ground_truth_streams` array. To debug a specific case, edit `eval/run-eval.ts` and add `console.log(predicted.scenarios.base.weeks)` inside `runCase()`.

### 3b. What the output actually tells you

| Metric | What it measures | What "good" looks like | What "bad" looks like |
|---|---|---|---|
| **MAE** (Mean Absolute Error) | Average dollar gap between predicted and ground-truth weekly balance, across all 13 weeks of the case | $0–$200: forecasting math is exact for this case's cadence pattern. $200–$1,000: small projection drift, usually a one-week off-by-one. $1,000+: a cadence the engine got wrong. | $5,000+: an entire stream got missed or projected to the wrong week, and the error compounds through later weeks because the balance roll-forward carries it. |
| **Max error** | The worst single week | Should be ≤ $400 if MAE is ≤ $200 | If max is 10× the MAE, it points to one specific bad week — open `eval/run-eval.ts`, log `errors` for that case, find the index, and look at what stream lands in that week. |
| **% weeks within $200** | Per-case pass rate | ≥90% per case is the bar | Below 90% = the case is exposing a real product limitation. Either fix the engine or document the limitation in CASE_STUDY (we did the latter for case-06). |
| **Weighted MAE (overall)** | Average per-week error across all cases | $0–$500 across the suite | $1,000+ means the engine is systematically wrong on common patterns. |

**What MAE is *not* telling you.** It's not a measurement of forecast accuracy against real banks — that requires backtesting (predict at time T, compare to actual balance at T+13 weeks). The eval set tests *math correctness*, not *world correctness*. The product's primary guardrail (forecast accuracy ±10%) needs the latter once you have real users; MAE is the unit-test layer underneath.

**The honest negative metric.** Case 06 fails on purpose: 69.2% within tolerance, MAE $2,615. The IRS quarterly schedule is calendar-anchored (Apr/Jun/Sep/Jan 15), but the engine models the stream as a 91-day median gap, so it projects the next payment ~30 days later than it really lands. This is exactly the kind of trade-off you should be ready to talk through in an interview: "the engine works for the 95% case; the 5% is calendar-anchored payments and it's the next thing on the roadmap."

### 3c. Manually verifying that explanations don't hallucinate

The build-time guardrail in `scripts/explain.ts` already enforces this every time you regenerate the cache. If you want to confirm by hand for a recruiter, here are three ways:

**Quickest — read the explanation, ctrl-F the description in the data.**

1. Open the dashboard, click *Why is this happening?* on any at-risk card.
2. Pick any all-caps phrase in the explanation (e.g. `WESTLAKE PROPERTIES RENT`).
3. Open `data/transactions.json` in your editor and search for that exact phrase. It should appear at least once.
4. Repeat for every all-caps phrase in the explanation. Zero misses = zero hallucination on this card.

**Programmatic — run the same check the build does.**

```bash
node --experimental-strip-types scripts/explain.ts
```

This re-runs the guardrail extractor and exits non-zero if any cited phrase is missing from the source data. The output line `Wrote 2 explanations (citation guardrail: PASS).` confirms a clean run.

**Adversarial — try to break it.**

1. Open `scripts/explain.ts`.
2. In the `HAND_EXPLANATIONS` array, change `WESTLAKE PROPERTIES RENT` to `WESTPACK PROPERTIES RENT` (typo).
3. Re-run `node --experimental-strip-types scripts/explain.ts`.
4. You'll see:

   ```
   HALLUCINATION GUARDRAIL FAILED:
     week 1: cited "WESTPACK PROPERTIES RENT" not found in any transaction
   ```

   Process exits with code 1. Revert the change to clear it.

This is the demo to do *live* if a recruiter asks "how do you know it doesn't hallucinate?" — it takes 30 seconds.

---

## 4. The 90-Second Recruiter-Ready Test

Run this checklist on the live URL **before** you put it on your resume. If any step doesn't match, the demo isn't ready.

### Pre-flight (do once, after deploy)

- [ ] Open the URL in a fresh incognito window. The dashboard should render fully populated within 2 seconds. **No empty state, no spinner.** This is the seeded data working — `data/*.json` is bundled into the build, `lib/data.ts` reads it at request time, and `app/page.tsx` renders the Dashboard with that data passed in as props. No user action triggers it; the seed *is* the page.
- [ ] Open the browser DevTools Network tab and refresh. Confirm there are zero 4xx/5xx requests. You should see one HTML request, a handful of `_next/static/...` chunks, and nothing else.
- [ ] Confirm the URL works on a friend's phone or a different network — rules out "works on my laptop" config bugs.

### The 5 clicks

**Click 1 — Re-connect bank.** Top-right button → *Re-connect bank*.
- Modal opens within 200ms.
- Click *Chase Business* (the highlighted "Demo · auto-fills" tile).
- Watch the four loading lines tick: *Authenticating → Verifying → Fetching → Categorizing*.
- The "✓ Connected" green confirmation flashes, then the modal auto-closes.
- **Why this matters:** demonstrates the connection flow without exposing that Plaid is mocked. Total time ≈ 3 seconds.

**Click 2 — Hover the red dot on Week 1 in the chart.**
- Tooltip appears with: week date range, all three scenario balances (optimistic / base / pessimistic), inflow + outflow totals, and the words *"Below threshold"* in coral.
- **Why this matters:** proves the chart isn't decorative — every dot has data and a tooltip carries the trade-off context.

**Click 3 — Open the Week 1 explanation.** In the right sidebar, click *Why is this happening? ↓* on the Week 1 card.
- Card expands to a 3-4 sentence paragraph naming Gusto Payroll, Westlake Rent, and Anthem Health by their exact descriptions.
- Below the paragraph: three "driver" rows showing each transaction with its dollar amount.
- **Why this matters:** this is the AI PM core. Recruiter sees that the explanation isn't generic, it cites real data, and the underlying transactions are listed inline so the user can verify.

**Click 4 — Drag the threshold slider from $5,000 up to $15,000.**
- Chart re-renders within 100ms — multiple new red dots appear (Week 9 in particular).
- The "At-risk weeks" sidebar count jumps from 2 to 4-5.
- The header stat "At-risk weeks" changes color from coral to a higher number.
- Drag back down to $5,000; everything snaps back.
- **Why this matters:** demonstrates direct manipulation, real-time recompute, and that the threshold is a first-class user input — not a config knob.

**Click 5 — Toggle the *Optimistic* scenario off.**
- The green line disappears from the chart immediately.
- The chart Y-axis auto-rescales to fit the remaining two lines.
- Toggle it back on; the green line returns.
- **Why this matters:** scenario toggle is a core differentiator and proves the three-scenarios architecture isn't just three static calls — they're independent, addressable, and orthogonal.

### Bonus 30-second close

If the recruiter is still watching after the 5 clicks:

- **Click *Send feedback*** (top-right). Type one word, hit *Send*. The success state confirms — this proves the feedback loop is wired and demonstrates the "every feature has a measurement plan" instinct from your project rules.
- **Open the browser console** and re-do clicks 2-5. Every interaction prints a `[track] {...}` line. That's the analytics shim emitting events that PostHog/Amplitude/Segment can pick up with one line of glue code. This is what the north-star metric (`forecast_viewed`) and guardrail metrics get measured against.

### What to do if something is broken

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard loads empty / shows "No data" | `data/*.json` files weren't bundled | Confirm `data/` is committed (not git-ignored). Re-deploy. |
| Red dot doesn't appear on Week 1 | Threshold slider was changed mid-session and persisted | The seeded build has no persistence; this shouldn't happen. If it does, hard-refresh. |
| Explanation card shows "No explanation generated for this week" | `data/explanations.json` is missing or empty | Re-run `node --experimental-strip-types scripts/explain.ts`, commit, redeploy. |
| Chart never animates / scenarios don't toggle | JavaScript error in the bundle | Open DevTools console; if you see a Recharts or React error, the most common cause is a Tailwind class typo that broke a component render. Look for the failing className. |
| Slider works but at-risk count doesn't update | `useMemo` dependency array is stale | Check `components/Dashboard.tsx` — `forecast` should be `useMemo`'d on `[props, threshold]`. |

---

## Appendix: Quick reference

**Regenerate the seeded demo from scratch:**

```bash
npm run seed                                              # data/transactions.json
node --experimental-strip-types scripts/categorize.ts     # data/categorized.json
node --experimental-strip-types scripts/explain.ts        # data/explanations.json (with guardrail)
npm run eval                                              # confirm 94.9% PASS
```

**Cache-bust on Vercel (after editing seed):**

Push to GitHub. Vercel auto-deploys main. There's no need to clear the build cache — the JSON files change so the build hash changes.

**Add a new at-risk-week explanation by hand:**

Edit `HAND_EXPLANATIONS` in `scripts/explain.ts`, run the script, commit `data/explanations.json`, redeploy.

**Switch from rules-fallback to live Claude categorization:**

Set `ANTHROPIC_API_KEY=...` in `.env.local`, run `node --experimental-strip-types scripts/categorize.ts`. The output's `source` field flips from `rules-fallback` to `claude-3-5-sonnet`.
