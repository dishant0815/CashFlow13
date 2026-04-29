"use client";

// ScenarioSwitcher — header dropdown that swaps the dashboard's data
// between three pre-calculated demo profiles. Visible when:
//   • NODE_ENV === "development"  (always on locally), OR
//   • the URL contains ?scenarios=1  (hidden toggle for prod demos)
//
// Hidden in plain production. The keyboard shortcut Shift+S also toggles
// it on for the current session if the user wants to reveal it during a
// live demo without changing the URL.

import { useEffect, useState } from "react";
import { ChevronDown, Building2, Store, Receipt, Beaker } from "lucide-react";
import { classNames } from "@/lib/format";
import type { ScenarioBundle, ScenarioId } from "@/lib/scenarios";

interface Props {
  scenarios: Record<ScenarioId, ScenarioBundle>;
  current: ScenarioId;
  onChange: (id: ScenarioId) => void;
}

const ICONS: Record<ScenarioId, React.ComponentType<{ className?: string }>> = {
  agency: Building2,
  retail: Store,
  "tax-crisis": Receipt,
};

export function ScenarioSwitcher({ scenarios, current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [forceVisible, setForceVisible] = useState(false);

  // Visibility logic: dev mode always; prod requires ?scenarios=1 OR
  // a Shift+S key combo that flips a session flag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("scenarios")) {
      setForceVisible(true);
      return;
    }
    const stored = window.sessionStorage.getItem("cf13_scenarios_visible");
    if (stored === "1") setForceVisible(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "S" || e.key === "s")) {
        const target = e.target as HTMLElement | null;
        // don't fire when typing in inputs
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        const next = !forceVisible;
        setForceVisible(next);
        window.sessionStorage.setItem("cf13_scenarios_visible", next ? "1" : "0");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forceVisible]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-cf13-scenario-switcher="1"]')) return;
      setOpen(false);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  const isDev =
    typeof process !== "undefined" && process.env.NODE_ENV === "development";
  const visible = isDev || forceVisible;
  if (!visible) return null;

  const order: ScenarioId[] = ["agency", "retail", "tax-crisis"];
  const currentBundle = scenarios[current];
  const CurrentIcon = ICONS[current];

  return (
    <div className="relative" data-cf13-scenario-switcher="1">
      <button
        onClick={() => setOpen((v) => !v)}
        className={classNames(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition",
          "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Beaker className="w-3.5 h-3.5" />
        <span className="font-semibold">Demo:</span>
        <CurrentIcon className="w-3.5 h-3.5" />
        <span>{currentBundle.meta.label}</span>
        <ChevronDown className={classNames("w-3.5 h-3.5 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 glass rounded-xl p-1.5 z-50 shadow-glow"
          role="listbox"
        >
          {order.map((id) => {
            const b = scenarios[id];
            const Icon = ICONS[id];
            const isCurrent = id === current;
            return (
              <button
                key={id}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className={classNames(
                  "w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition",
                  isCurrent
                    ? "bg-amber-400/15 ring-1 ring-amber-400/30"
                    : "hover:bg-white/5"
                )}
                role="option"
                aria-selected={isCurrent}
              >
                <Icon
                  className={classNames(
                    "w-5 h-5 mt-0.5 shrink-0",
                    isCurrent ? "text-amber-200" : "text-slate-400"
                  )}
                />
                <div className="min-w-0">
                  <div className="font-semibold text-white text-sm">
                    {b.meta.label}
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">
                      {b.transactions.length} txns · {b.forecast.at_risk_weeks.length} at-risk
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {b.meta.description}
                  </div>
                </div>
              </button>
            );
          })}
          <div className="border-t border-white/5 mt-1 pt-2 px-3 pb-1">
            <div className="text-[10px] text-slate-500">
              Demo only · pre-calculated · Shift+S to toggle
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
