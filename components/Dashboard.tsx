"use client";

// Dashboard — the main UI shell.
//
// State model after the fake-door refactor:
//   • scenarioId: which pre-computed bundle is rendering right now
//   • livePresentation: bool — is the user "in the middle" of a live demo?
//     (controls the green pulse + bank-mask styling vs the violet/demo styling)
//   • threshold: user-controlled red-line; default = the scenario's own
//   • visibleScenarios: which of the 3 forecast lines are toggled on
//   • openExplanationWeek: which at-risk card is expanded
//
// There is no backend live-data state. When the fake pipeline finishes,
// we just switch scenarioId to "retail" + flip livePresentation true.

import { useEffect, useMemo, useState } from "react";
import { ForecastChart } from "./ForecastChart";
import { PlaidLinkLauncher } from "./PlaidLink";
import { LivePipeline } from "./LivePipeline";
import { ScenarioSwitcher } from "./ScenarioSwitcher";
import { ErrorBoundary } from "./ErrorBoundary";
import { useToast } from "./Toast";
import { buildForecast } from "@/lib/forecast";
import type { Explanation, ForecastResult, ScenarioName } from "@/lib/types";
import type { ScenarioBundle, ScenarioId } from "@/lib/scenarios";
import { fmtUSD, fmtUSDExact, fmtDateRange, classNames } from "@/lib/format";
import { track } from "@/lib/track";

interface Props {
  scenarios: Record<ScenarioId, ScenarioBundle>;
  initialScenario: ScenarioId;
}

const PIPELINE_LANDING_SCENARIO: ScenarioId = "retail";

export function Dashboard({ scenarios, initialScenario }: Props) {
  return (
    <ErrorBoundary fallbackTitle="The dashboard hit an unexpected error">
      <DashboardInner scenarios={scenarios} initialScenario={initialScenario} />
    </ErrorBoundary>
  );
}

function DashboardInner({ scenarios, initialScenario }: Props) {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initialScenario);
  const [livePresentation, setLivePresentation] = useState(false);
  const [threshold, setThreshold] = useState<number>(
    scenarios[initialScenario].meta.threshold_dollars
  );
  const [visibleScenarios, setVisibleScenarios] = useState<Record<ScenarioName, boolean>>({
    optimistic: true,
    base: true,
    pessimistic: true,
  });
  const [openExplanationWeek, setOpenExplanationWeek] = useState<number | null>(null);
  const [plaidOpen, setPlaidOpen] = useState(false);
  const [pipelineActive, setPipelineActive] = useState(false);

  const { toast } = useToast();

  const bundle = scenarios[scenarioId];

  // Forecast recomputes when transactions, starting balance, or threshold change.
  const forecast: ForecastResult = useMemo(
    () =>
      buildForecast({
        transactions: bundle.transactions,
        starting_balance: bundle.meta.starting_balance,
        threshold_dollars: threshold,
        today: bundle.meta.today,
        business_name: bundle.meta.business_name,
      }),
    [bundle, threshold]
  );

  const explanationByWeek = useMemo(() => {
    const m = new Map<number, Explanation>();
    for (const e of bundle.explanations) m.set(e.week_index, e);
    return m;
  }, [bundle.explanations]);

  // Reset threshold when the scenario changes (each scenario has its own default).
  useEffect(() => {
    setThreshold(scenarios[scenarioId].meta.threshold_dollars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  // Mount-only tracking. Empty deps intentional.
  useEffect(() => {
    track("page_loaded", { scenario: scenarioId });
    track("forecast_viewed", { threshold });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Plaid + fake-door pipeline =====
  const onPlaidConnected = () => {
    setPlaidOpen(false);
    track("connect_bank_completed", {});
    setPipelineActive(true);
  };
  const onPlaidAbort = () => setPlaidOpen(false);

  const onPipelineComplete = () => {
    setPipelineActive(false);
    setScenarioId(PIPELINE_LANDING_SCENARIO);
    setLivePresentation(true);
    setThreshold(scenarios[PIPELINE_LANDING_SCENARIO].meta.threshold_dollars);
    track("forecast_viewed", { source: "live", scenario: PIPELINE_LANDING_SCENARIO });
    toast({
      variant: "success",
      title: "Forecast ready",
      description: `${scenarios[PIPELINE_LANDING_SCENARIO].transactions.length} transactions analyzed · ${scenarios[PIPELINE_LANDING_SCENARIO].forecast.at_risk_weeks.length} at-risk weeks flagged.`,
    });
  };

  const onScenarioChange = (id: ScenarioId) => {
    setScenarioId(id);
    setLivePresentation(false);
    track("scenario_switched", { scenario: id });
  };

  return (
    <main className="min-h-screen w-full">
      <PlaidLinkLauncher
        open={plaidOpen}
        onConnected={onPlaidConnected}
        onAbort={onPlaidAbort}
      />
      <LivePipeline active={pipelineActive} onComplete={onPipelineComplete} />

      <header className="px-6 md:px-10 pt-7 pb-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-white font-bold text-lg leading-tight">CashFlow13</div>
              <div className="text-xs text-slate-400 -mt-0.5">
                13-week forecast for small businesses
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <ScenarioSwitcher
              scenarios={scenarios}
              current={scenarioId}
              onChange={onScenarioChange}
            />
            <BankPill mask={bundle.meta.bank_account_mask} live={livePresentation} />
            <button
              onClick={() => {
                track("connect_bank_clicked", {});
                setPlaidOpen(true);
              }}
              className="rounded-full px-4 py-2 text-sm font-semibold btn-primary disabled:opacity-50"
              disabled={pipelineActive}
            >
              Connect bank
            </button>
          </div>
        </div>
      </header>

      <section className="px-6 md:px-10 pb-12 max-w-7xl mx-auto">
        <HeroStats
          businessName={bundle.meta.business_name}
          startingBalance={bundle.meta.starting_balance}
          forecast={forecast}
        />

        <div className="grid lg:grid-cols-3 gap-5 mt-5">
          <div className="lg:col-span-2 glass rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-white font-bold text-lg">13-week cash position</h2>
                <p className="text-xs text-slate-400">
                  Three scenarios. Red dots are weeks below your threshold.
                </p>
              </div>
              <ScenarioToggle
                scenarios={visibleScenarios}
                onChange={setVisibleScenarios}
              />
            </div>
            <ForecastChart forecast={forecast} visibleScenarios={visibleScenarios} />
            <ThresholdSlider value={threshold} onChange={setThreshold} />
          </div>

          <aside className="glass rounded-2xl p-5">
            <h2 className="text-white font-bold text-lg">At-risk weeks</h2>
            <p className="text-xs text-slate-400 mb-4">
              {forecast.at_risk_weeks.length === 0
                ? "Nothing flagged at this threshold. Try sliding it up."
                : `${forecast.at_risk_weeks.length} week${
                    forecast.at_risk_weeks.length === 1 ? "" : "s"
                  } projected below ${fmtUSD(threshold)}.`}
            </p>
            <div className="space-y-3">
              {forecast.at_risk_weeks.length === 0 ? (
                <EmptyAtRisk />
              ) : (
                forecast.at_risk_weeks.map((w) => (
                  <AtRiskCard
                    key={w.week_index}
                    week={w}
                    explanation={explanationByWeek.get(w.week_index)}
                    threshold={threshold}
                    open={openExplanationWeek === w.week_index}
                    onToggle={() => {
                      const opening = openExplanationWeek !== w.week_index;
                      setOpenExplanationWeek(opening ? w.week_index : null);
                      if (opening) track("at_risk_explanation_opened", { week: w.week_index });
                    }}
                  />
                ))
              )}
            </div>
          </aside>
        </div>

        <Footer live={livePresentation} />
      </section>
    </main>
  );
}

// ============== sub-components ==============

function Logo() {
  return (
    <div className="w-10 h-10 rounded-xl bg-grad-cta shadow-glow flex items-center justify-center font-black text-ink-900">
      13
    </div>
  );
}

function BankPill({ mask, live }: { mask: string; live: boolean }) {
  return (
    <div
      className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
      style={{
        background: live ? "rgba(61,245,176,0.08)" : "rgba(139,92,246,0.08)",
        border: `1px solid ${live ? "rgba(61,245,176,0.25)" : "rgba(139,92,246,0.25)"}`,
      }}
    >
      <span
        className={classNames(
          "w-1.5 h-1.5 rounded-full animate-pulse",
          live ? "bg-mint" : "bg-violet-400"
        )}
      />
      <span
        className={classNames("font-medium", live ? "text-mint" : "text-violet-300")}
      >
        {mask}
      </span>
      {!live && (
        <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1">
          demo
        </span>
      )}
    </div>
  );
}

function HeroStats({
  businessName,
  startingBalance,
  forecast,
}: {
  businessName: string;
  startingBalance: number;
  forecast: ForecastResult;
}) {
  const lowest = forecast.scenarios.base.weeks.reduce(
    (lo, w) => (w.projected_balance < lo.projected_balance ? w : lo),
    forecast.scenarios.base.weeks[0]
  );
  const ending = forecast.scenarios.base.weeks[12];

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">
            {businessName}
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white mt-1 tracking-tight">
            Your next 13 weeks of cash
            <span className="bg-gradient-to-r from-violet-500 to-mint bg-clip-text text-transparent">
              .
            </span>
          </h1>
        </div>
        <FeedbackButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <Stat label="Today's balance" value={fmtUSDExact(startingBalance)} accent="mint" />
        <Stat
          label={`Lowest week (W${lowest.week_index})`}
          value={fmtUSDExact(lowest.projected_balance)}
          accent={lowest.projected_balance < forecast.threshold_dollars ? "coral" : "violet"}
          sub={fmtDateRange(lowest.week_start, lowest.week_end)}
        />
        <Stat
          label="Week 13 ending"
          value={fmtUSDExact(ending.projected_balance)}
          accent="violet"
        />
        <Stat
          label="At-risk weeks"
          value={String(forecast.at_risk_weeks.length)}
          accent={forecast.at_risk_weeks.length ? "coral" : "mint"}
          sub={`Threshold ${fmtUSD(forecast.threshold_dollars)}`}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "mint" | "violet" | "coral";
}) {
  const ring =
    accent === "mint"
      ? "ring-mint/30 from-mint/15 to-transparent"
      : accent === "coral"
      ? "ring-coral/30 from-coral/15 to-transparent"
      : "ring-violet-500/30 from-violet-500/15 to-transparent";
  const text =
    accent === "mint"
      ? "text-mint"
      : accent === "coral"
      ? "text-coral"
      : "text-violet-300";
  return (
    <div className={classNames("rounded-2xl p-4 ring-1 bg-gradient-to-br", ring)}>
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={classNames("font-black text-2xl mt-1 tabular-nums", text)}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function ScenarioToggle({
  scenarios,
  onChange,
}: {
  scenarios: Record<ScenarioName, boolean>;
  onChange: (next: Record<ScenarioName, boolean>) => void;
}) {
  const items: Array<{ key: ScenarioName; label: string; color: string }> = [
    { key: "optimistic", label: "Optimistic", color: "bg-mint/20 text-mint border-mint/30" },
    {
      key: "base",
      label: "Base",
      color: "bg-violet-500/20 text-violet-200 border-violet-500/30",
    },
    {
      key: "pessimistic",
      label: "Pessimistic",
      color: "bg-coral/20 text-coral border-coral/30",
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = scenarios[it.key];
        return (
          <button
            key={it.key}
            onClick={() => {
              const next = { ...scenarios, [it.key]: !on };
              if (Object.values(next).every((v) => !v)) return;
              onChange(next);
              track("scenario_switched", { scenario: it.key, on: !on });
            }}
            className={classNames(
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition",
              on ? it.color : "bg-white/5 text-slate-500 border-white/10 hover:text-slate-300"
            )}
            aria-pressed={on}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function ThresholdSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const min = 0;
  const max = 50_000;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs uppercase tracking-wider text-slate-400">
          Safety threshold
        </label>
        <div className="text-sm font-bold text-white tabular-nums">
          {fmtUSDExact(value)}
        </div>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={500}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => track("threshold_changed", { value })}
        style={{ ["--pct" as never]: `${pct}%` }}
      />
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        <span>{fmtUSD(min)}</span>
        <span>{fmtUSD(max / 2)}</span>
        <span>{fmtUSD(max)}</span>
      </div>
    </div>
  );
}

function AtRiskCard({
  week,
  explanation,
  threshold,
  open,
  onToggle,
}: {
  week: ForecastResult["at_risk_weeks"][number];
  explanation: Explanation | undefined;
  threshold: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-coral/30 bg-coral/5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-coral">
            Week {week.week_index}
          </div>
          <div className="text-sm text-slate-300">
            {fmtDateRange(week.week_start, week.week_end)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-black text-lg text-white tabular-nums">
            {fmtUSDExact(week.projected_balance)}
          </div>
          <div className="text-xs text-coral">
            {fmtUSDExact(week.shortfall)} below {fmtUSD(threshold)}
          </div>
        </div>
      </div>
      <button
        onClick={onToggle}
        className="mt-3 text-xs font-semibold text-violet-300 hover:text-violet-200"
      >
        {open ? "Hide explanation ↑" : "Why is this happening? ↓"}
      </button>
      {open && (
        <div className="mt-3 text-sm text-slate-200 leading-relaxed">
          {explanation?.explanation ?? (
            <span className="text-slate-400 italic">
              No pre-computed explanation for this week (you moved the threshold).
              Drivers below are still real transactions from the data.
            </span>
          )}
          <div className="mt-3 grid gap-1">
            {week.drivers.map((d) => (
              <div
                key={d.transaction_id}
                className="flex items-center justify-between text-xs rounded-md px-2 py-1.5"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <span className="text-slate-300 font-mono truncate">{d.description}</span>
                <span className="text-coral tabular-nums ml-3 shrink-0">
                  {fmtUSDExact(d.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyAtRisk() {
  return (
    <div className="rounded-xl border border-mint/30 bg-mint/5 p-4 text-sm text-mint/90">
      Nothing flagged. You're projected to stay above your floor across all 13 weeks.
    </div>
  );
}

function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-2 rounded-full border border-white/10 text-slate-300 hover:bg-white/5"
      >
        Send feedback
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 glass rounded-xl p-4 z-30"
          onClick={(e) => e.stopPropagation()}
        >
          {sent ? (
            <div className="text-sm text-mint">Thanks — sent.</div>
          ) : (
            <>
              <div className="text-xs text-slate-400 mb-1">
                What's confusing or wrong?
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="w-full text-sm bg-ink-800 rounded-lg p-2 text-white outline-none border border-white/10"
                placeholder="e.g. the explanation missed the Adobe quarterly bill…"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => {
                    track("feedback_submitted", { length: text.length });
                    setSent(true);
                    setTimeout(() => {
                      setSent(false);
                      setOpen(false);
                      setText("");
                    }, 1400);
                  }}
                  disabled={!text.trim()}
                  className="text-xs btn-primary px-3 py-1.5 rounded-full disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Footer({ live }: { live: boolean }) {
  return (
    <footer className="mt-10 pt-6 border-t border-white/5 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
      <div>
        {live
          ? "Live data via Plaid sandbox · forecast computed locally."
          : "Demo scenario · pre-calculated · click Connect bank for the live flow."}
      </div>
      <div>
        Built as a portfolio MVP ·{" "}
        <a
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
          className="text-violet-300 hover:underline"
        >
          README + case study
        </a>
      </div>
    </footer>
  );
}
