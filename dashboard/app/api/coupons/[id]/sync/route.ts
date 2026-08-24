export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { syncCouponToProvider, type CouponSyncArgs } from "@/lib/coupon-provider-sync"

/**
 * Re-sync an existing coupon to ONE provider (?provider=stripe|razorpay|
 * google_play|app_store). Used to backfill a coupon's provider offers without
 * re-saving it, and to stay under the free Cloudflare 50-subrequest cap by
 * syncing provider-by-provider. Best-effort — always 200 with a ran flag.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const provider = new URL(req.url).searchParams.get("provider") ?? ""

  const { data: c, error } = await supabase
    .from("tenant_coupons")
    .select("id, code, name, percent_off, duration, duration_in_months, max_redemptions, redeem_by, applies_to_product_ids")
    .eq("tenant_id", tenant.id)
    .eq("id", params.id)
    .single()
  if (error || !c) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const args: CouponSyncArgs = {
    tenantId: tenant.id,
    couponRowId: c.id,
    code: c.code,
    name: c.name ?? null,
    percentOff: Number(c.percent_off),
    duration: c.duration,
    durationInMonths: c.duration_in_months ?? null,
    maxRedemptions: c.max_redemptions ?? null,
    redeemBy: c.redeem_by ?? null,
    appliesToProductIds: c.applies_to_product_ids ?? null,
  }
  const result = await syncCouponToProvider(provider, args)
  return NextResponse.json({ provider, ...result })
}
