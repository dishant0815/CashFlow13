"use client";

// Fake-door pipeline.
//
// Pure visual timer: 4 stages × ~1.5s each = ~6 seconds total. No fetch
// calls, no buildForecast, no error states (there are no failure modes
// in a setTimeout chain). Parent invokes the timer by flipping `active`
// and gets a single onComplete callback when every stage finishes.

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Building2,
  BrainCircuit,
  LineChart,
  Sparkles,
} from "lucide-react";
import { classNames } from "@/lib/format";

interface Props {
  active: boolean;
  onComplete: () => void;
}

interface Stage {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  ms: number;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    label: "Syncing bank…",
    description: "Pulling 365 days of transactions via Plaid",
    icon: Building2,
    ms: 1500,
  },
  {
    label: "AI categorizing…",
    description: "Gemini Flash labeling each transaction",
    icon: BrainCircuit,
    ms: 1700,
  },
  {
    label: "Calculating forecast…",
    description: "Detecting cadences, projecting 13 weeks × 3 scenarios",
    icon: LineChart,
    ms: 1300,
  },
  {
    label: "Drafting explanations…",
    description: "Plain-English narrative for each at-risk week",
    icon: Sparkles,
    ms: 1500,
  },
];

export function LivePipeline({ active, onComplete }: Props) {
  // currentStage is the index of the stage that is *running* (or
  // STAGES.length once everything is done).
  const [currentStage, setCurrentStage] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setCurrentStage(0);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < STAGES.length; i++) {
        if (cancelled) return;
        setCurrentStage(i);
        await new Promise<void>((resolve) => setTimeout(resolve, STAGES[i].ms));
      }
      if (cancelled) return;
      setCurrentStage(STAGES.length);
      onComplete();
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [active, onComplete]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(7,9,26,0.85)", backdropFilter: "blur(8px)" }}
    >
      <div className="glass rounded-2xl p-6 w-full max-w-md shadow-glow">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-grad-cta flex items-center justify-center font-black text-ink-900 text-sm">
            13
          </div>
          <div>
            <div className="font-bold text-white">Building your live forecast</div>
            <div className="text-xs text-slate-400">
              This usually takes 6–10 seconds.
            </div>
          </div>
        </div>
        <ul className="mt-5 space-y-3">
          {STAGES.map((s, i) => {
            const state: "done" | "running" | "pending" =
              i < currentStage ? "done" : i === currentStage ? "running" : "pending";
            return (
              <StageRow
                key={s.label}
                label={s.label}
                description={s.description}
                icon={s.icon}
                state={state}
              />
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StageRow({
  label,
  description,
  icon: Icon,
  state,
}: {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  state: "done" | "running" | "pending";
}) {
  return (
    <li className="flex items-start gap-3">
      <div
        className={classNames(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition",
          state === "done" && "bg-mint/15 border-mint/40 text-mint",
          state === "running" && "bg-violet-500/15 border-violet-500/40 text-violet-300",
          state === "pending" && "bg-white/5 border-white/10 text-slate-600"
        )}
      >
        {state === "running" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : state === "done" ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={classNames(
            "text-sm font-semibold",
            state === "done" && "text-mint",
            state === "running" && "text-white",
            state === "pending" && "text-slate-400"
          )}
        >
          {label}
        </div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </li>
  );
}
