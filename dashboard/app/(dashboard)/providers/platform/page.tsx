import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { PlatformProvidersPanel } from "@/components/providers/platform-providers-panel"

/**
 * Platform providers — a first-class CONFIGURE page (sidebar item) for the per-platform provider
 * selector. Picks which provider each app platform (iOS / Android / Desktop / Web) uses, with fees
 * shown, backed by the migration-075 routing engine. iOS/Android digital is handled by the native
 * store automatically; Desktop/Web are routable.
 */
export default async function PlatformProvidersPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [providersRes, registryRes, routingRes] = await Promise.all([
    supabase.from("tenant_providers").select("provider").eq("tenant_id", tenant.id),
    supabase
      .from("provider_method_registry")
      .select("method, provider, display_name, fee_percent")
      .order("fee_percent"),
    supabase.rpc("tenant_routing_rules_list", { p_tenant_id: tenant.id }),
  ])

  const connectedProviders = [
    ...new Set((providersRes.data ?? []).map((r: any) => r.provider as string)),
  ]

  return (
    <div>
      <PageHeader
        title="Platform providers"
        subtitle="For each platform, pick a primary provider and an optional fallback used when the primary can't serve a customer. iOS and Android digital subscriptions always use the native store."
      />
      <PlatformProvidersPanel
        registry={(registryRes.data ?? []) as any}
        connectedProviders={connectedProviders}
        initialRules={(routingRes.data ?? []) as any}
      />
    </div>
  )
}
