# Roadmap

Each item names the user problem it solves. "Now" is being worked on, "Next" is committed and ordered, "Later" is planned but not scheduled. Shipped work moves to [CHANGELOG.md](./CHANGELOG.md).

## Now

- **Calendar-anchored tax dates.** *Problem:* quarterly estimated taxes are projected about a month late (eval case 6 fails at 69.2%), so the owner can be warned in the wrong week about one of their largest bills. Snap tax streams to IRS due dates (Apr 15, Jun 15, Sep 15, Jan 15) and make case 6 pass.

## Next

1. **Add a known upcoming bill or invoice.** *Problem:* the conservative engine skips one-off obligations (an annual premium seen once, a big invoice due next month), so the forecast can look safer than it is. Let the owner add a dated amount that flows into the forecast.
2. **Explanations for any at-risk week.** *Problem:* after moving the threshold, newly flagged weeks show drivers but no written explanation. Generate the template explanation in the browser (with the same guardrail) for every flagged week.

## Later

- **LLM-written explanations behind the citation guardrail.** *Problem:* template text is accurate but formulaic; owners may act more readily on an explanation that reads like an accountant's note. Any explanation that fails `checkCitations()` falls back to the template.
- **LLM categorization with rules as fallback.** *Problem:* real merchant descriptions are messy ("GUSTO PYRL 4412"), and a rule list won't cover the long tail once real bank data is involved.
- **Weekly digest (email or Slack).** *Problem:* a forecast only helps if the owner remembers to open it; pushing the at-risk weeks to them every Monday builds the habit.
- **Real bank data via Plaid + persistence.** *Problem:* mock scenarios prove the mechanism, not usefulness for a specific business. Draft schema is in [OPERATIONS.md](./OPERATIONS.md#appendix-draft-persistence-schema-designed-not-wired-up).
- **"What if" lever.** *Problem:* owners want to know what closing one more deal or delaying one bill would do. Hypothesis to test: a single lever could replace the optimistic line.
