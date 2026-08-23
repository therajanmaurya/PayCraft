import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  cashfreeSyncProduct,
  googlePlaySyncProduct,
  appStoreSyncProduct,
} from "@/lib/stripe-route-helper"

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  // Strip pricing_rows from the product payload — stored separately in tenant_pricing.
  const { pricing_rows, ...productPayload } = body
  const payload = { ...productPayload, tenant_id: tenant.id }

  const { data: id, error } = await supabase.rpc("tenant_products_upsert", {
    p_row: payload,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.created",
    p_resource: `tenant_products:id=${id}`,
    p_after: payload,
  })

  // Persist per-country price rows when provided (auto / manual mode).
  if (Array.isArray(pricing_rows) && pricing_rows.length > 0) {
    await supabase.rpc("tenant_pricing_bulk_upsert", {
      p_tenant_id: tenant.id,
      p_product_id: id,
      p_rows: pricing_rows,
    })
  }

  // Best-effort multi-provider sync (all run concurrently). Each self-skips when
  // the tenant hasn't connected that provider, and NEVER throws to us (internally
  // caught). We AWAIT them and return a per-provider summary so the operator can
  // SEE whether a product — and its free-trial offer — actually provisioned to
  // Google Play / App Store / Stripe (integrity for the "auto-sync trials" flow),
  // rather than silently discarding the result. Store-provider failures/DRAFTs are
  // exactly the Subscriptions-policy mismatch that gets a build rejected.
  const [, , , googleR, appstoreR] = await Promise.all([
    stripeSyncProduct(supabase, { tenantId: tenant.id, productId: id, body }),
    razorpaySyncProduct(supabase, { tenantId: tenant.id, productId: id, body }),
    cashfreeSyncProduct(supabase, { tenantId: tenant.id, productId: id, body }),
    googlePlaySyncProduct(supabase, { tenantId: tenant.id, productId: id, body }),
    appStoreSyncProduct(supabase, { tenantId: tenant.id, productId: id, body }),
  ])

  // Only surface providers that report status (the native stores — Google Play +
  // App Store — where a trial must be provisioned as a store offer). Stripe/
  // Razorpay/Cashfree log internally today; their status is a follow-up.
  const sync: Record<string, { error?: string; warning?: string }> = {}
  if (googleR && (googleR.error || googleR.warning)) sync.google_play = googleR
  if (appstoreR && appstoreR.error) sync.app_store = appstoreR

  return NextResponse.json({ id, sync })
}
