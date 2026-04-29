"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";
import type { ForecastResult, ScenarioName, WeekSnapshot } from "@/lib/types";
import { fmtUSD, fmtUSDExact, fmtDateRange } from "@/lib/format";

interface Props {
  forecast: ForecastResult;
  visibleScenarios: Record<ScenarioName, boolean>;
}

const COLORS: Record<ScenarioName, string> = {
  optimistic: "#3DF5B0",
  base: "#A78BFA",
  pessimistic: "#FB7185",
};

export function ForecastChart({ forecast, visibleScenarios }: Props) {
  const baseWeeks = forecast.scenarios.base.weeks;
  const optWeeks = forecast.scenarios.optimistic.weeks;
  const pessWeeks = forecast.scenarios.pessimistic.weeks;

  // Merge into one row per week for Recharts.
  const data = baseWeeks.map((w, i) => ({
    week: `W${w.week_index}`,
    week_index: w.week_index,
    week_start: w.week_start,
    week_end: w.week_end,
    base: w.projected_balance,
    optimistic: optWeeks[i].projected_balance,
    pessimistic: pessWeeks[i].projected_balance,
    threshold: forecast.threshold_dollars,
    at_risk: w.projected_balance < forecast.threshold_dollars,
    inflow: w.inflow_total,
    outflow: w.outflow_total,
  }));

  return (
    <div className="w-full h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 32, left: 8, bottom: 8 }}>
          <defs>
            <linearGradient id="baseGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" />
          <XAxis dataKey="week" tickMargin={8} />
          <YAxis
            width={64}
            tickFormatter={(v: number) => fmtUSD(v, { compact: true })}
            domain={[
              (dataMin: number) => Math.min(dataMin - 5_000, 0),
              (dataMax: number) => Math.max(dataMax + 5_000, forecast.threshold_dollars + 5_000),
            ]}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{ paddingBottom: 12, color: "#cbd5e1", fontSize: 12 }}
          />
          <ReferenceLine
            y={forecast.threshold_dollars}
            stroke="#FB7185"
            strokeDasharray="5 4"
            label={{
              value: `Threshold ${fmtUSD(forecast.threshold_dollars)}`,
              fill: "#FB7185",
              fontSize: 11,
              position: "insideTopRight",
            }}
          />
          {visibleScenarios.optimistic && (
            <Line
              type="monotone"
              dataKey="optimistic"
              name="Optimistic"
              stroke={COLORS.optimistic}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: COLORS.optimistic }}
              activeDot={{ r: 5 }}
              isAnimationActive
            />
          )}
          {visibleScenarios.base && (
            <Line
              type="monotone"
              dataKey="base"
              name="Base"
              stroke="url(#baseGrad)"
              strokeWidth={3}
              dot={(props: unknown) => <BaseDot {...(props as DotProps)} />}
              activeDot={{ r: 6 }}
              isAnimationActive
            />
          )}
          {visibleScenarios.pessimistic && (
            <Line
              type="monotone"
              dataKey="pessimistic"
              name="Pessimistic"
              stroke={COLORS.pessimistic}
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={{ r: 3, strokeWidth: 0, fill: COLORS.pessimistic }}
              activeDot={{ r: 5 }}
              isAnimationActive
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: { at_risk: boolean; week_index: number };
}

function BaseDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload) return null;
  if (payload.at_risk) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={11} fill="#FB7185" opacity={0.18} />
        <circle cx={cx} cy={cy} r={6} fill="#FB7185" stroke="#0b1020" strokeWidth={2} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={4} fill="#A78BFA" />;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { week_index: number; week_start: string; week_end: string; base: number; optimistic: number; pessimistic: number; inflow: number; outflow: number; at_risk: boolean } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(11,16,32,0.96)", border: "1px solid rgba(139,92,246,0.4)" }}>
      <div className="text-slate-300 font-semibold">
        Week {p.week_index} · {fmtDateRange(p.week_start, p.week_end)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-mint">Optimistic</div>
        <div className="text-right tabular-nums">{fmtUSDExact(p.optimistic)}</div>
        <div className="text-violet-300">Base</div>
        <div className="text-right tabular-nums font-semibold">{fmtUSDExact(p.base)}</div>
        <div className="text-coral">Pessimistic</div>
        <div className="text-right tabular-nums">{fmtUSDExact(p.pessimistic)}</div>
        <div className="text-slate-400 col-span-2 mt-1 border-t border-white/10 pt-1">
          Inflow {fmtUSDExact(p.inflow)} · Outflow {fmtUSDExact(p.outflow)}
        </div>
        {p.at_risk && (
          <div className="text-coral col-span-2 font-semibold">Below threshold</div>
        )}
      </div>
    </div>
  );
}
