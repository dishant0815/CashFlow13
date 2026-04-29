// MobileFallback — CSS-only viewport guard.
//
// No JavaScript detection (which would create hydration mismatches);
// purely Tailwind responsive classes. Visible on screens narrower than
// md (768px), hidden at md and above. Pair this with a sibling
// `<div className="hidden md:block">` wrapping the dashboard so the
// two states are mutually exclusive at the CSS layer.
//
// Server-renderable, no "use client" needed.

import { Monitor, Sparkles } from "lucide-react";

export function MobileFallback() {
  return (
    <div className="md:hidden min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-grad-cta shadow-glow flex items-center justify-center font-black text-ink-900 text-xl mb-6">
        13
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-5"
        style={{ background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.30)" }}>
        <Monitor className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-violet-200 font-medium">Desktop required</span>
      </div>

      <h1 className="text-2xl font-black text-white tracking-tight mb-3">
        CashFlow13 is a desktop-class
        <span className="block bg-gradient-to-r from-violet-400 to-mint bg-clip-text text-transparent">
          financial engine.
        </span>
      </h1>
      <p className="text-sm text-slate-300 max-w-xs leading-relaxed">
        Please view on a desktop or laptop to explore the interactive 13-week
        forecast, three-scenario chart, and at-risk-week explanations.
      </p>

      <div className="mt-8 grid gap-2 text-left max-w-xs w-full">
        <Bullet>Connect a sandbox bank in 30 seconds</Bullet>
        <Bullet>Watch Gemini Flash categorize 365 days of transactions</Bullet>
        <Bullet>Drag the threshold slider; chart re-renders live</Bullet>
        <Bullet>Plain-English explanation for every red week</Bullet>
      </div>

      <div className="mt-8 text-xs text-slate-500 flex items-center gap-2">
        <Sparkles className="w-3 h-3" />
        Built as an AI PM portfolio MVP
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-slate-300">
      <span className="mt-1 w-1 h-1 rounded-full bg-mint shrink-0" />
      <span>{children}</span>
    </div>
  );
}
