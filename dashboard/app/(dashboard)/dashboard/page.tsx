export const runtime = "edge"

import Link from "next/link"
import {
  Activity,
  DollarSign,
  Users,
  Sparkles,
  LayoutGrid,
  Webhook,
  UserPlus,
  PlusCircle,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardHeader, CardBody, StatCard } from "@/components/ui/card"
import { ButtonLink } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { AppsMatrix, type AppMatrixRow } from "@/components/dashboard/apps-matrix"
import { AppsComparisonChart } from "@/components/charts/apps-comparison-chart"

/**
 * Account overview — the app-matrix across EVERY app the signed-in account owns.
 * Cross-tenant metrics are read from the 5 tenant_* analytics views WITHOUT a
 * tenant_id filter: migration 082 made them security_invoker with tenant-admin
 * base-table RLS, so an un-filtered query returns exactly one row per owned app.
 */
export default async function OverviewPage() {
  const { tenant } = await requireTenant() // redirects to /onboarding when the account has no apps
  const supabase = createClient()
  const apps = await getUserApps()

  const [mrrRes, subsRes, webhookRes, productsRes, providersRes, auditRes] = await Promise.all([
    supabase.from("tenant_mrr_view").select("tenant_id, mrr_dollars"),
    supabase.from("tenant_subscriber_count_view").select("tenant_id, active_count, trial_count, canceled_count"),
    supabase.from("tenant_webhook_delivery_view").select("tenant_id, total, success, success_rate"),
    supabase.from("tenant_products").select("tenant_id").eq("active", true),
    supabase.from("tenant_providers").select("tenant_id"),
    supabase.from("tenant_audit_log").select("id, tenant_id, action, actor_type, ts").order("ts", { ascending: false }).limit(8),
  ])

  // Index each metric set by tenant_id.
  const mrrById = new Map<string, number>()
  for (const r of mrrRes.data ?? []) mrrById.set(r.tenant_id, Number(r.mrr_dollars ?? 0))
  const subsById = new Map<string, { active: number; trial: number; canceled: number }>()
  for (const r of subsRes.data ?? [])
    subsById.set(r.tenant_id, { active: r.active_count ?? 0, trial: r.trial_count ?? 0, canceled: r.canceled_count ?? 0 })
  const whById = new Map<string, { total: number; success: number; rate: number }>()
  for (const r of webhookRes.data ?? [])
    whById.set(r.tenant_id, { total: r.total ?? 0, success: r.success ?? 0, rate: r.success_rate ?? 1 })
  const countBy = (rows: { tenant_id: string }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1)
    return m
  }
  const productsById = countBy(productsRes.data)
  const providersById = countBy(providersRes.data)
  const appName = new Map(apps.map((a) => [a.id, a.name]))

  const rows: AppMatrixRow[] = apps.map((a) => {
    const s = subsById.get(a.id)
    const wh = whById.get(a.id)
    return {
      id: a.id,
      name: a.name,
      plan: a.plan,
      mrr: mrrById.get(a.id) ?? 0,
      active: s?.active ?? 0,
      trials: s?.trial ?? 0,
      canceled: s?.canceled ?? 0,
      products: productsById.get(a.id) ?? 0,
      providers: providersById.get(a.id) ?? 0,
      webhookRate: wh?.rate ?? 1,
      webhookTotal: wh?.total ?? 0,
    }
  })

  // Account-wide roll-ups.
  const totalMrr = rows.reduce((n, r) => n + r.mrr, 0)
  const totalActive = rows.reduce((n, r) => n + r.active, 0)
  const totalTrials = rows.reduce((n, r) => n + r.trials, 0)
  const whTotals = rows.reduce((acc, r) => ({ total: acc.total + r.webhookTotal, success: acc.success + Math.round(r.webhookRate * r.webhookTotal) }), { total: 0, success: 0 })
  const acctWebhookRate = whTotals.total > 0 ? whTotals.success / whTotals.total : null
  const liveApps = rows.filter((r) => r.products > 0 && r.providers > 0).length

  const chartData = rows.map((r) => ({ name: r.name, mrr: r.mrr, active: r.active }))
  const account = tenant.owner_email

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            <span className="tabular-nums font-medium text-ink-700">{apps.length}</span>{" "}
            {apps.length === 1 ? "app" : "apps"} under{" "}
            <span className="font-medium text-ink-700">{account}</span> · combined performance across every app.
          </>
        }
        actions={
          <>
            <ButtonLink href="/apps/new" variant="secondary" size="sm" leading={<PlusCircle className="w-4 h-4" />}>
              New app
            </ButtonLink>
            <ButtonLink href="/analytics" variant="primary" size="sm" leading={<Sparkles className="w-4 h-4" />}>
              Analytics
            </ButtonLink>
          </>
        }
      />

      {/* Account KPI strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-slide-up">
        <StatCard
          label="Total MRR"
          value={`$${totalMrr.toLocaleString()}`}
          helper="Across all apps"
          icon={<DollarSign className="w-4 h-4" />}
          trend={totalMrr > 0 ? { value: "live", tone: "success" } : undefined}
        />
        <StatCard
          label="Active subscribers"
          value={totalActive.toLocaleString()}
          helper={totalTrials > 0 ? `${totalTrials.toLocaleString()} trialing` : "No trials active"}
          icon={<Users className="w-4 h-4" />}
        />
        <StatCard
          label="Apps live"
          value={`${liveApps}/${apps.length}`}
          helper="Products + provider connected"
          icon={<LayoutGrid className="w-4 h-4" />}
          trend={liveApps === apps.length && apps.length > 0 ? { value: "all set", tone: "brand" } : undefined}
        />
        <StatCard
          label="Webhook health"
          value={acctWebhookRate === null ? "—" : `${(acctWebhookRate * 100).toFixed(1)}%`}
          helper={acctWebhookRate === null ? "No deliveries yet" : "Last 30 days"}
          icon={<Webhook className="w-4 h-4" />}
          trend={acctWebhookRate !== null ? { value: acctWebhookRate >= 0.99 ? "healthy" : "check", tone: acctWebhookRate >= 0.99 ? "success" : "danger" } : undefined}
        />
      </section>

      {/* Comparison + matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-8 items-start">
        <div className="xl:col-span-5">
          <Card>
            <CardHeader title="MRR by app" subtitle="Monthly recurring revenue per app" />
            <CardBody>
              <AppsComparisonChart data={chartData} metric="mrr" />
            </CardBody>
          </Card>
        </div>
        <div className="xl:col-span-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink-500 uppercase tracking-wider">App matrix</h2>
            <Link href="/apps" className="text-xs font-bold text-brand-600 hover:underline">
              Manage apps →
            </Link>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="w-5 h-5" />}
              title="No apps yet"
              description="Register your first app to start tracking billing across platforms."
              action={<ButtonLink href="/apps/new" variant="primary" size="sm">Register an app</ButtonLink>}
            />
          ) : (
            <AppsMatrix rows={rows} />
          )}
        </div>
      </div>

      {/* Account-wide recent activity */}
      <Card>
        <CardHeader
          title="Recent activity"
          subtitle="Across all your apps"
          action={<Link href="/audit" className="text-xs font-bold text-brand-600 hover:underline">View audit log →</Link>}
        />
        {(auditRes.data ?? []).length === 0 ? (
          <CardBody>
            <div className="py-6 text-center">
              <Activity className="w-5 h-5 text-ink-300 mx-auto mb-2" />
              <p className="text-sm text-ink-500">No activity yet — changes across your apps will show up here.</p>
            </div>
          </CardBody>
        ) : (
          <div className="divide-y divide-ink-100">
            {(auditRes.data ?? []).map((row: any) => (
              <div key={row.id} className="px-5 py-3 flex items-center justify-between hover:bg-ink-50/70 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " +
                      (row.actor_type === "user"
                        ? "bg-info-50 text-info-600"
                        : row.actor_type === "webhook"
                        ? "bg-ink-100 text-ink-600"
                        : "bg-brand-50 text-brand-600")
                    }
                  >
                    {row.actor_type === "user" ? (
                      <UserPlus className="w-4 h-4" />
                    ) : row.actor_type === "webhook" ? (
                      <Webhook className="w-4 h-4" />
                    ) : (
                      <Activity className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate">{row.action}</p>
                    <p className="text-xs text-ink-500 font-medium truncate">
                      {appName.get(row.tenant_id) ?? "—"} · <span className="capitalize">{row.actor_type}</span>
                    </p>
                  </div>
                </div>
                <span className="text-xs text-ink-400 font-medium flex-shrink-0 ml-3">{relativeTime(row.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
