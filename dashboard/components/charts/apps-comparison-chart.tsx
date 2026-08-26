"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export interface AppsComparisonRow {
  name: string
  mrr: number
  active: number
}

/**
 * Horizontal bar comparison of the account's apps by a chosen metric. Matches the
 * sibling recharts wrappers' conventions (brand violet #7C3AED, ink-500 #71717A
 * axes). Client component — recharts needs the DOM.
 */
export function AppsComparisonChart({
  data,
  metric = "mrr",
}: {
  data: AppsComparisonRow[]
  metric?: "mrr" | "active"
}) {
  const rows = [...data].sort((a, b) => (b[metric] as number) - (a[metric] as number))
  const isMrr = metric === "mrr"
  const fmt = (v: number) => (isMrr ? `$${v.toLocaleString()}` : v.toLocaleString())

  if (rows.length === 0 || rows.every((r) => (r[metric] as number) === 0)) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-ink-400">
        No {isMrr ? "revenue" : "subscriber"} data yet across your apps.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 46 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke="#E4E4E7" strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={(v) => fmt(Number(v))}
          tick={{ fill: "#71717A", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fill: "#3F3F46", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "#7C3AED0D" }}
          formatter={(v: number) => [fmt(Number(v)), isMrr ? "MRR" : "Active subs"]}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #E4E4E7",
            fontSize: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          }}
        />
        <Bar dataKey={metric} radius={[0, 6, 6, 0]} maxBarSize={26}>
          {rows.map((_, i) => (
            <Cell key={i} fill={i === 0 ? "#7C3AED" : "#A78BFA"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
