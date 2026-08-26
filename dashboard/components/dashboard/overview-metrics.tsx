"use client"

import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { clsx } from "clsx"
import { ArrowDownRight, ArrowUpRight, DollarSign, Users, Sparkles, TrendingUp } from "lucide-react"

/** One daily datapoint. All fields are computed from real `subscriptions` rows. */
export interface OverviewPoint {
  date: string // YYYY-MM-DD
  revenue: number // proxy MRR (active × ARPU) — see page
  active: number // active subscriptions on that day
  trials: number // active trials on that day
  newSubs: number // subscriptions created that day
}

type MetricKey = "revenue" | "active" | "trials" | "newSubs"
const RANGES = [
  { key: "28d", label: "28D", days: 28 },
  { key: "3m", label: "3M", days: 90 },
  { key: "12m", label: "12M", days: 365 },
] as const

const METRICS: { key: MetricKey; label: string; money?: boolean; icon: React.ReactNode; cumulative?: boolean }[] = [
  { key: "revenue", label: "Monthly recurring revenue", money: true, icon: <DollarSign className="w-4 h-4" />, cumulative: true },
  { key: "active", label: "Active subscriptions", icon: <Users className="w-4 h-4" />, cumulative: true },
  { key: "trials", label: "Active trials", icon: <Sparkles className="w-4 h-4" />, cumulative: true },
  { key: "newSubs", label: "New subscriptions", icon: <TrendingUp className="w-4 h-4" /> },
]

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`
const fmtNum = (n: number) => Math.round(n).toLocaleString()

export function OverviewMetrics({ series }: { series: OverviewPoint[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("3m")
  const [metric, setMetric] = useState<MetricKey>("active")

  const days = RANGES.find((r) => r.key === range)!.days
  const windowed = useMemo(() => series.slice(Math.max(0, series.length - days)), [series, days])

  const summarize = (key: MetricKey, cumulative?: boolean) => {
    if (windowed.length === 0) return { current: 0, delta: null as number | null }
    const last = windowed[windowed.length - 1][key]
    if (cumulative) {
      const first = windowed[0][key]
      const delta = first === 0 ? (last > 0 ? 100 : 0) : ((last - first) / first) * 100
      return { current: last, delta }
    }
    // flow metric (new subs): sum over the window vs prior equal window
    const sum = windowed.reduce((n, p) => n + (p[key] as number), 0)
    const prior = series.slice(Math.max(0, series.length - days * 2), Math.max(0, series.length - days))
    const priorSum = prior.reduce((n, p) => n + (p[key] as number), 0)
    const delta = priorSum === 0 ? (sum > 0 ? 100 : 0) : ((sum - priorSum) / priorSum) * 100
    return { current: sum, delta }
  }

  const activeMetric = METRICS.find((m) => m.key === metric)!

  return (
    <div className="space-y-5">
      {/* Range tabs */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-500 uppercase tracking-wider">Performance</h2>
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={clsx(
                "px-3 py-1 text-xs font-bold rounded-md transition-colors",
                range === r.key ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards — click to drive the main chart */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {METRICS.map((m) => {
          const { current, delta } = summarize(m.key, m.cumulative)
          const selected = m.key === metric
          const spark = windowed.map((p) => ({ v: p[m.key] as number }))
          return (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={clsx(
                "text-left bg-white rounded-xl border p-4 transition-all",
                selected ? "border-brand-400 ring-2 ring-brand-500/15 shadow-sm" : "border-ink-200 hover:border-ink-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xs font-semibold text-ink-500 uppercase tracking-wider">{m.label}</span>
                <span className={clsx("w-6 h-6 rounded-md flex items-center justify-center", selected ? "bg-brand-50 text-brand-600" : "bg-ink-100 text-ink-500")}>
                  {m.icon}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-2xl font-semibold text-ink-900 tracking-tight tabular-nums">
                  {m.money ? fmtMoney(current) : fmtNum(current)}
                </span>
                {delta !== null && (
                  <span
                    className={clsx(
                      "inline-flex items-center gap-0.5 text-2xs font-bold px-1.5 py-0.5 rounded",
                      delta > 0 ? "bg-success-50 text-success-700" : delta < 0 ? "bg-danger-50 text-danger-700" : "bg-ink-100 text-ink-600",
                    )}
                  >
                    {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : delta < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
                    {Math.abs(Math.round(delta))}%
                  </span>
                )}
              </div>
              <div className="h-9 mt-2 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={spark} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7C3AED" stopOpacity={selected ? 0.35 : 0.18} />
                        <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#7C3AED" strokeWidth={1.5} fill={`url(#spark-${m.key})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </button>
          )
        })}
      </div>

      {/* Main chart for the selected metric */}
      <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold text-ink-500">{activeMetric.label}</p>
            <p className="text-2xl font-semibold text-ink-900 tracking-tight tabular-nums mt-0.5">
              {(() => {
                const { current } = summarize(activeMetric.key, activeMetric.cumulative)
                return activeMetric.money ? fmtMoney(current) : fmtNum(current)
              })()}
            </p>
          </div>
          <span className="text-2xs font-medium text-ink-400">
            {activeMetric.cumulative ? "point-in-time" : `summed over ${RANGES.find((r) => r.key === range)!.label}`}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={windowed} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="main-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#F4F4F5" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#A1A1AA", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
              tickFormatter={(d: string) => {
                const dt = new Date(d)
                return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
              }}
            />
            <YAxis
              tick={{ fill: "#A1A1AA", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => (activeMetric.money ? `$${v}` : `${v}`)}
              allowDecimals={false}
            />
            <Tooltip
              formatter={(v: number) => [activeMetric.money ? fmtMoney(Number(v)) : fmtNum(Number(v)), activeMetric.label]}
              labelFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
              contentStyle={{ borderRadius: 10, border: "1px solid #E4E4E7", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}
            />
            <Area type="monotone" dataKey={metric} stroke="#7C3AED" strokeWidth={2} fill="url(#main-area)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
