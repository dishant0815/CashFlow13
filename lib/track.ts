// Minimal event-tracking shim.
//
// In production you'd wire `track()` to PostHog / Amplitude / Segment. For
// the MVP we log to console and emit a CustomEvent so the browser dev tools
// (or Cypress, or a thin PostHog shim added later) can pick it up.
//
// North-star metric: `forecast_viewed` per session.
// Guardrail metrics:
//   • `at_risk_explanation_opened` — proves the LLM explanations earn clicks
//   • `threshold_changed` — engagement signal for the slider
//   • `scenario_switched` — does the 3-scenario toggle get used?
//   • `connect_bank_clicked` — top-of-funnel conversion

export type EventName =
  | "page_loaded"
  | "connect_bank_clicked"
  | "connect_bank_completed"
  | "forecast_viewed"
  | "threshold_changed"
  | "scenario_switched"
  | "at_risk_explanation_opened"
  | "feedback_submitted";

export function track(event: EventName, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const payload = { event, props, ts: Date.now() };
  // eslint-disable-next-line no-console
  console.log("[track]", payload);
  try {
    window.dispatchEvent(new CustomEvent("cf13:track", { detail: payload }));
  } catch {
    // best-effort; never throw from tracking
  }
}
