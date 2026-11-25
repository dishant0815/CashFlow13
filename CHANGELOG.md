# Changelog

Notable changes to CashFlow13. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-11-25

### Added
- Citation guardrail (`lib/guardrail.ts`): every explanation may only cite transaction ids and vendor names that exist in the scenario data. `npm run seed` refuses to write a failing bundle; `npm run verify:citations` checks the committed bundles.
- Dashboard screenshot in the README, plus `ROADMAP.md` and this changelog.

### Fixed
- In-app copy now matches what the demo does: after *Connect bank* the footer says the pre-computed Retail mock scenario is shown (it previously said "Live data via Plaid sandbox"), and the progress and mobile screens no longer mention Gemini, which this build doesn't call.
- Footer "README + case study" link pointed to github.com instead of this repo.
- README, case study, operations guide, Loom script and `.env.example` described LLM routes, scripts and data files that aren't in the repo. They now describe the shipped code; planned integrations live in `ROADMAP.md`.

## 2026-05-09 and earlier

- Scenario switcher shown in production as primary navigation (Agency / Retail / Tax Crisis).
- Plaid sandbox "front door" with a pre-computed demo behind it, so the demo can't time out.
- 13-week, three-scenario forecast engine (`lib/forecast.ts`) with a six-case eval harness.
