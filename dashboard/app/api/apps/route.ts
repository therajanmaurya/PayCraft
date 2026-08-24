export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase.rpc("provision_app", {
    p_app_name: name.trim(),
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function GET() {
  const supabase = createClient()
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")
  const tenantIds = (memberships ?? []).map((r: any) => r.tenant_id)
  if (!tenantIds.length) return NextResponse.json([])

  const { data: apps } = await supabase
    .from("tenants")
    .select("id, name, plan, api_key_live, owner_email, created_at")
    .in("id", tenantIds)
    .order("created_at")

  // Connected providers per app (for the add-app "reuse providers" picker). The
  // tenant-admin SELECT policy scopes this to the caller's apps; only provider
  // NAMES are returned — never any key ciphertext.
  const { data: provRows } = await supabase
    .from("tenant_providers")
    .select("tenant_id, provider, is_active")
    .in("tenant_id", tenantIds)

  const byTenant: Record<string, string[]> = {}
  for (const r of (provRows ?? []) as { tenant_id: string; provider: string; is_active: boolean }[]) {
    if (r.is_active === false) continue
    ;(byTenant[r.tenant_id] ??= []).push(r.provider)
  }

  const withProviders = (apps ?? []).map((a: Record<string, unknown>) => ({
    ...a,
    providers: byTenant[a.id as string] ?? [],
  }))

  return NextResponse.json(withProviders)
}