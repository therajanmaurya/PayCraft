export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Google Play store credentials persistence — mirrors the Stripe / Cashfree
 * Manual keys route, but stores a SINGLE service-account JSON blob (encrypted)
 * plus the non-secret package name via `tenant_providers_save_store_keys`.
 *
 * Body: { service_account_json?: string, package_name?: string }
 *   - service_account_json: the whole SA JSON document (paste or file upload).
 *     Empty on a partial update keeps the existing encrypted blob.
 *   - package_name: the Android application id (com.example.app).
 *
 * The secret VALUE is NEVER echoed back — only { ok, mode } is returned.
 */
interface Body {
  service_account_json: string
  package_name: string
  account_label: string
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<Body>
  const supabase = createClient()

  const saJson = (body.service_account_json ?? "").trim()
  const packageName = (body.package_name ?? "").trim()

  // First-save vs partial-update branch — same detection as the PSP routes.
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("store_credential_enc, store_config")
    .eq("tenant_id", tenant.id)
    .eq("provider", "google_play")
    .maybeSingle()
  const isUpdate = !!existing

  // Validate: on first save the SA JSON is required and must parse with the
  // fields the JWT-bearer grant needs. package_name is always required.
  if (!packageName) {
    return NextResponse.json({ error: "package_name is required" }, { status: 400 })
  }
  if (saJson) {
    try {
      const parsed = JSON.parse(saJson) as { client_email?: string; private_key?: string }
      if (!parsed.client_email || !parsed.private_key) {
        return NextResponse.json(
          { error: "service_account_json must contain client_email and private_key" },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: "service_account_json is not valid JSON" },
        { status: 400 },
      )
    }
  } else if (!isUpdate) {
    return NextResponse.json(
      { error: "service_account_json required for first-time save" },
      { status: 400 },
    )
  }

  // Auto-capture the service-account email (a NON-secret identifier) so it can be
  // shown in the app-switcher / "reuse providers" picker without ever decrypting
  // the credential. Derived from the uploaded JSON; preserved from the existing
  // config on a package-only update.
  const existingCfg = (existing?.store_config as Record<string, unknown> | null) ?? {}
  let accountEmail = (existingCfg.account_email as string) ?? undefined
  if (saJson) {
    try {
      accountEmail = (JSON.parse(saJson) as { client_email?: string }).client_email ?? accountEmail
    } catch {
      /* validated above */
    }
  }
  const config: Record<string, unknown> = { package_name: packageName }
  if (accountEmail) config.account_email = accountEmail
  // Optional operator-supplied label overrides what's shown; else the SA email is used.
  const accountLabel = (body.account_label ?? "").trim() || ((existingCfg.account_label as string) ?? "")
  if (accountLabel) config.account_label = accountLabel

  const { error } = await supabase.rpc("tenant_providers_save_store_keys", {
    p_tenant_id: tenant.id,
    p_provider: "google_play",
    p_credential: saJson || "", // "" → keep existing blob on update
    p_config: config,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: isUpdate ? "update" : "create" })
}