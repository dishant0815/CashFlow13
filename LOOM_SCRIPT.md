# 90-second Loom script — CashFlow13

Recording target: 1:30. Practice once for pacing; speak slightly fast. Have the deployed URL pre-loaded in a clean browser tab. Threshold default $5,000. All three scenarios visible. Click order is in `[brackets]`.

---

**0:00 – 0:10 — the pain (no clicks, just talking head + URL on screen)**

> "Small-business owners know today's balance, not next month's — so a tax bill landing the same week as payroll becomes a surprise. Big companies use a 13-week forecast for this. CashFlow13 is that forecast, built as a portfolio project on mock data."

**0:10 – 0:30 — the scenarios** `[open the Scenario dropdown → show Agency, Retail, Tax Crisis → back to Agency]`

> "Three mock businesses with different cash patterns. Each has a year of generated transactions, labeled by a rules engine — payroll, rent, taxes, vendors — and the forecast engine detects which ones repeat and how often. The Connect bank button shows the real Plaid sandbox login; behind it, the demo loads pre-computed data so it never times out."

**0:30 – 0:50 — the chart** `[chart already on screen; point at the red dot on Week 1]`

> "Here's the next 13 weeks of cash. Three scenarios — optimistic, base, pessimistic. The red dots are weeks where the projected balance dips below the owner's safety floor. Two of them are flagged."

**0:50 – 1:15 — the explanation** `[click "Why is this happening?" on the Week 1 card]`

> "Here's the part I care about most. Click any red week and you get a plain-English explanation that cites the actual transactions — Gusto payroll, Westlake rent, Anthem health insurance — plus one concrete action. Today it's template-generated, and a citation guardrail fails the build if any explanation names a vendor that isn't in the data. That same rule is what an LLM-written version will have to pass."

**1:15 – 1:30 — slider + roadmap** `[drag threshold slider up to $15K so more weeks turn red, then back down]`

> "Owner controls the threshold live. Three scenarios toggle on the chart. Eval set runs at 95% within ±$200 with one honest weakness around quarterly tax timing. Next on the roadmap: fix that tax timing, then let owners add known upcoming bills."

---

## Recording checklist

- [ ] Browser zoomed to 100%, window 1280×800.
- [ ] DevTools closed.
- [ ] Mac menu bar hidden (System Settings → Control Center → Menu Bar Only).
- [ ] No notifications (Do Not Disturb on).
- [ ] Threshold slider at default $5,000 before recording.
- [ ] Agency scenario selected; all three chart lines toggled on at start.
- [ ] At-risk explanation cards collapsed at start.
- [ ] One practice take, then record. Cap at 95s; trim in Loom if needed.
