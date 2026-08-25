"use client"

import { ChevronRight } from "lucide-react"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"

export interface AppMatrixRow {
  id: string
  name: string
  plan: string
  mrr: number
  active: number
  trials: number
  canceled: number
  products: number
  providers: number
  webhookRate: number
  webhookTotal: number
}

const num = (n: number) => n.toLocaleString()

/**
 * Account-wide app matrix. Client component so the DataTable's row-drilldown
 * (rowHref) + cell renderers stay on the client; the server page passes only
 * serializable rows.
 */
export function AppsMatrix({ rows }: { rows: AppMatrixRow[] }) {
  return (
    <DataTable<AppMatrixRow>
      rows={rows}
      rowKey={(r) => r.id}
      rowHref={(r) => `/apps/${r.id}`}
      columns={[
        {
          key: "name",
          header: "App",
          cell: (r) => (
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{r.name}</span>
              <span>
                <Badge tone={r.plan === "free" ? "neutral" : "brand"}>{r.plan}</Badge>
              </span>
            </div>
          ),
        },
        {
          key: "mrr",
          header: "MRR",
          align: "right",
          cell: (r) => (
            <span className="tabular-nums font-semibold text-ink-900">
              ${num(r.mrr)}
            </span>
          ),
        },
        {
          key: "active",
          header: "Active",
          align: "right",
          cell: (r) => <span className="tabular-nums text-ink-800">{num(r.active)}</span>,
        },
        {
          key: "trials",
          header: "Trialing",
          align: "right",
          cell: (r) => (
            <span className={r.trials > 0 ? "tabular-nums text-brand-700 font-medium" : "tabular-nums text-ink-400"}>
              {num(r.trials)}
            </span>
          ),
        },
        {
          key: "products",
          header: "Products",
          align: "right",
          cell: (r) => <span className="tabular-nums text-ink-600">{num(r.products)}</span>,
        },
        {
          key: "providers",
          header: "Providers",
          align: "right",
          cell: (r) => <span className="tabular-nums text-ink-600">{num(r.providers)}</span>,
        },
        {
          key: "webhook",
          header: "Webhooks",
          align: "right",
          cell: (r) =>
            r.webhookTotal === 0 ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (r.webhookRate >= 0.99
                      ? "bg-success-500"
                      : r.webhookRate >= 0.9
                      ? "bg-warning-500"
                      : "bg-danger-500")
                  }
                />
                {(r.webhookRate * 100).toFixed(0)}%
              </span>
            ),
        },
        {
          key: "go",
          header: "",
          align: "right",
          width: "48px",
          cell: () => (
            <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all inline" />
          ),
        },
      ]}
    />
  )
}
