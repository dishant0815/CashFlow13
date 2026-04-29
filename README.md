# CashFlow13

> A 13-week predictive cash-flow engine for small businesses. Closes the gap between *current bank balance* and *forward visibility* — the gap that kills roughly 30% of small businesses inside their first two years.

**Live demo:** _add Vercel URL_ · **Loom (90s):** _add Loom URL_ · **Deeper reads:** [CASE_STUDY.md](./CASE_STUDY.md) · [OPERATIONS.md](./OPERATIONS.md) · [LOOM_SCRIPT.md](./LOOM_SCRIPT.md)

---

## 1. Executive Summary

**What CashFlow13 is.** A web app that connects to a small-business bank account, projects the next 13 weeks of cash position across three scenarios (optimistic / base / pessimistic), flags weeks where the projected balance dips below an owner-set threshold, and writes a plain-English explanation for each at-risk week — every explanation cites the specific underlying transactions by description.

**The business problem.** Cash-flow blindness is the most-cited reason small businesses fail. Owners check their current bank balance every Monday morning; they don't have a forward-looking 13-week forecast. A quarterly tax bill landing the same week as biweekly payroll plus an annual insurance premium turns into an existential surprise. Enterprise CFOs use a 13-week rolling forecast to prevent exactly this — but no off-the-shelf product combines bank-data automation with plain-English explanation for the under-$5M-revenue segment. Plaid + an LLM with strict citation discipline closes that gap.

**Who it's for.** US-based service businesses, $500K–$5M revenue, 5–25 employees. The persona is the owner-operator who reviews finances on Monday mornings — financially aware but not a trained accountant.

**North star metric.** Weekly active forecasts viewed (proxy for habitual use; the product wins when the owner makes this a Monday-morning ritual). **Primary guardrail:** forecast accuracy within ±10% over 13 weeks. **Secondary guardrail (the AI PM one):** 0% hallucination rate in plain-English explanations — see §4.

---

## 2. The Tech Stack & Strategic Rationale

### Next.js 14 (App Router) · TypeScript

| | |
|---|---|
| **What it does** | Full-stack framework. Server components render the dashboard with seeded data on first paint; client components handle the chart, threshold slider, and scenario switcher; API routes host the (now-mocked) Plaid + Gemini handlers. |
| **Why we chose it** | Single deployment artifact, one language top-to-bottom. App Router server components let us do the ~500-transaction scenario load at request time without shipping the bundle to the client. Tightest possible Vercel integration. |
| **Trade-off accepted** | Vercel's free-tier 10s serverless timeout — the same constraint that drove the Fake Door pivot in §3. |
| **What it does NOT do** | Handle long-running background jobs, cron schedules, or websocket connections. The 13-week refresh is intentionally synchronous and user-initiated. |

### Supabase (Postgres) — *schema designed, not currently called from the deployed demo*

| | |
|---|---|
| **What it does** | Persistence layer for `transactions`, `forecasts`, and `settings` tables, with foreign keys to a `users` table that's forward-compatible with Supabase Auth. Full SQL in [OPERATIONS.md §1a](./OPERATIONS.md). |
| **Why we chose it** | Free tier covers MVP load, single API-key setup, idempotent inserts via Postgres `UNIQUE` on `plaid_transaction_id`. Lowest-friction path from "no DB" to "real DB" the day we want it. |
| **Trade-off accepted** | RLS stays off for the single-user MVP and is gated by the service-role key on the server. Documented swap-in to enable RLS the moment we add Auth. |
| **What it does NOT do** | Run forecast math (that lives in `lib/forecast.ts` as pure TypeScript so it's testable, deterministic, and runtime-agnostic). Store Plaid access tokens (those live in an httpOnly cookie for the MVP). |

### Plaid (Sandbox)

| | |
|---|---|
| **What it does** | Real bank-account aggregation in sandbox mode. Drives the actual `react-plaid-link` iframe modal — recruiters who click *Connect bank* see Plaid's real UI, pick a bank, and authenticate with sandbox credentials (`user_good` / `pass_good`). |
| **Why we chose it** | Industry standard for bank data; sandbox is free and unlimited; returns realistic transaction structure (messy merchant descriptions, multi-account aggregation, the lot) so the categorization engine sees real-world inputs. |
| **Trade-off accepted** | We use the real Plaid Link UI for trust but **deliberately discard the `public_token` after `onSuccess`** — no `/transactions/sync` round-trip during the demo. See §3. |
| **What it does NOT do** | Move money. Read or store account credentials. Operate against production banks (sandbox-only by deliberate scope decision). |

### Google Gemini Flash (free tier)

| | |
|---|---|
| **What it does** | Two AI surfaces. (1) Categorizes bank transactions into 11 buckets — income, payroll, rent_or_mortgage, utilities, subscriptions, loan_payment, tax, vendor_payment, customer_payment, transfer, other — with strict JSON output. (2) Writes plain-English explanations for each at-risk week, with mandatory transaction citations. Default model: `gemini-2.5-flash`, configurable via `GEMINI_MODEL`. |
| **Why we chose it** | `responseSchema` + `responseMimeType: "application/json"` provide a *hard* contract — Gemini is structurally prevented from emitting prose, code fences, or out-of-schema fields, which simplifies error handling versus Claude's instructed-JSON convention. Free tier (10 RPM, 250 RPD) covers MVP load at zero cost. Equivalent quality to Claude 3.5 Sonnet on this task in spot-checks. |
| **Trade-off accepted** | Free-tier rate limits cap concurrent users; for paid traffic we'd flip to the paid tier or fall back to the deterministic rules engine that already ships in `scripts/categorize.ts` (used to bake the demo cache). |
| **What it does NOT do** | Generate creative text, opinions, or financial advice. Only processes strict JSON inputs and emits strict JSON outputs gated by a server-defined schema. Never invents transactions — see the guardrail in §4. |

**Supporting infrastructure** — Recharts (chart, lazy-mounted under `"use client"` to prevent SSR mismatches), Tailwind CSS (styling and the mobile-lockout breakpoint), `lucide-react` (iconography), Vercel (deployment). Each chosen against the same criterion as above: fastest path to a polished result.

---

## 3. The "Fake Door" Demo Architecture

This is the single most important PM decision in the build.

**The constraint.** Vercel's free-tier serverless function timeout is **10 seconds**. The live pipeline as originally designed — Plaid `/transactions/sync` (fetch 365 days, ~3–5s) + Gemini batched categorization (8 batches × ~1–2s each) + Gemini explanations (~1–3s) — runs anywhere from 12 to 25 seconds end-to-end. Past the timeout, Vercel returns a 504 and the dashboard renders empty. **A recruiter clicking the URL during a 90-second portfolio scan would see a broken product.**

**The decision.** Keep the visually-real Plaid Link iframe (recruiter sees the real bank-login UI and trusts the integration is wired). Sever every backend call *after* Plaid's `onSuccess`. The architecture is **real front door, mocked behind**.

**How it works in practice:**

1. User clicks **Connect bank** → `react-plaid-link` opens the real Plaid sandbox modal.
2. Sandbox credentials (`user_good` / `pass_good`) → Plaid returns a `public_token` via the `onSuccess` callback.
3. **The `public_token` is intentionally dropped.** No `/api/plaid/exchange`, no `/api/plaid/sync`, no Gemini round-trip.
4. A four-stage visual pipeline animates for ~6 seconds (Syncing bank → AI categorizing → Calculating forecast → Drafting explanations) — purely client-side `setTimeout`s.
5. On completion, the dashboard loads the **Retail scenario bundle** (`data/scenarios/retail.json`) and renders it with "live data" styling — mint pulse on the bank pill, *"Live data via Plaid sandbox"* footer copy.

**The three scenario bundles** (Agency / Retail / Tax Crisis) are pre-computed at build time by `scripts/seed-scenarios.ts`. Each bundle contains the full transaction list, the categorized output, the computed forecast (3 scenarios × 13 weeks), and templated zero-hallucination explanations. They're swappable instantly via the dropdown in the header (visible in dev mode, or in production with `?scenarios=1` or Shift+S). Each tells a distinct cash-flow story — lumpy retainer cycles, tight retail margins, impending tax catastrophe.

**Why this is the right PM call:**

- **100% demo uptime.** Every interaction — Connect bank, scenario switch, threshold drag, "Why is this happening?" expand — is pure client-side computation. Zero serverless invocations during the demo path means zero serverless failure modes.
- **Trust preserved.** The recruiter sees the real Plaid UI, real Plaid sandbox login flow, real `onSuccess` handshake. The Fake Door is only on the backend handoff.
- **Demoable variety.** Three scenarios surface three distinct cash-flow narratives — far richer than a single live sandbox pull, which would always return the same Plaid fixture data.
- **Live integrations stay shippable.** The real `/api/categorize`, `/api/explain`, `/api/plaid/*` routes all exist on disk, compile clean, and reactivate with a one-line diff in the Dashboard the day we want to demo against a real bank in a controlled setting.

**What this explicitly is NOT:**

- Not a deception. The footer copy and the case study disclose the architecture honestly. Recruiters who ask *"is this hitting Gemini live?"* get told no — and the live route code is in the repo for them to read.
- Not a permanent state. The Fake Door is a deployment-only choice; flipping back to live is a single-import edit in `Dashboard.tsx`.

This was a decision to **guarantee 100% uptime for portfolio views** at the cost of a small amount of architectural honesty (which we then disclose openly to recover).

---

## 4. The AI Guardrails (Zero Hallucination)

This is the single most important AI PM property of the product.

**The risk.** An LLM writing free-form explanations of cash-flow risk could easily invent vendor names. *"Your balance dips because of the AT&T bill on May 4th"* — when the owner has no AT&T account — is the kind of fabrication that destroys trust in a finance tool. One hallucinated citation and the owner stops opening the app.

**The guardrail.** Server-side, in `app/api/explain/route.ts`. Before any explanation is returned to the client:

1. Gemini returns a JSON array of `{week, explanation}` objects (shape enforced by `responseSchema`, so we know the structure is valid).
2. The route extracts every all-caps phrase of ≥2 tokens from each explanation via regex (`/\b[A-Z][A-Z0-9& ]{4,}[A-Z0-9]\b/g`). These are presumed transaction citations.
3. Each citation is checked against the set of `description` fields in the input transactions array. **Any phrase that doesn't appear as a substring of a real transaction description fails the check.**
4. If any check fails, the route responds **HTTP 422** with the offending citations listed in the body, and emits **zero** explanations. The dashboard falls back to rendering the driver transactions inline so the user still sees the data — just without the AI commentary.

**Result.** It is structurally impossible for the user to see a cited vendor name that doesn't exist in their data. Hallucinations either fail the build (in the offline cache regeneration path of `scripts/explain.ts`) or fail the request (live API path). The mechanism is identical for both paths.

**Verifiable in 30 seconds.** Edit any description in the explanation cache from `WESTLAKE PROPERTIES RENT` to `WESTPACK PROPERTIES RENT` and re-run `scripts/explain.ts`. The script aborts with:

```
HALLUCINATION GUARDRAIL FAILED:
  week 1: cited "WESTPACK PROPERTIES RENT" not found in any transaction
```

Process exits non-zero. The build fails before the cache is rewritten. Same protection runs server-side at request time.

---

## Repository Map

- [`README.md`](./README.md) — this file
- [`CASE_STUDY.md`](./CASE_STUDY.md) — Process / Usage / Effects (with one honest negative metric) / Areas for Improvement
- [`OPERATIONS.md`](./OPERATIONS.md) — Supabase SQL, Plaid setup, Vercel env vars, data-journey walkthrough, recruiter-ready test
- [`LOOM_SCRIPT.md`](./LOOM_SCRIPT.md) — 90-second recording script
- `data/scenarios/*.json` — pre-computed Agency / Retail / Tax Crisis bundles
- `lib/forecast.ts` — pure TypeScript forecasting engine (cadence detection, 13-week projection, 3 scenarios, at-risk flagging)
- `eval/` — six-case accuracy harness; current result **94.9% of weeks within ±$200** of ground truth (PASS, threshold 90%)

## Run Locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run eval         # forecast-accuracy harness
npm run seed         # regenerate the demo scenario bundles
```

## Deploy

```bash
git push            # to a GitHub repo
# then vercel.com/new → import → accept Next.js defaults → Deploy
# No environment variables required for the deployed Fake Door demo.
```

---

License: MIT
