import { createClient } from "./supabase-server"
import { appStoreConnectToken, type AppStoreConnectCreds } from "./store-jwt"
import { ascFetch, resolveAscSubscriptionId } from "./appstore-product-sync"

/**
 * Apply a PayCraft coupon (percent_off) to a tenant's App Store subscriptions as
 * a PAY_AS_YOU_GO introductory offer at a DISCOUNTED price point — the StoreKit
 * equivalent of a coupon. Mirrors the FREE_TRIAL introductory-offer flow in
 * appstore-product-sync.ts, but the offer carries a discounted price instead of
 * being free.
 *
 * Per-product: one introductory offer per applicable subscription that has an
 * app_store_product_id. Best-effort — failures logged, never surface to the CRUD
 * flow (parity with Stripe/Razorpay/Play coupon sync).
 *
 * Platform limits (documented, not bugs): Apple offers apply to NEW subscribers,
 * use a FIXED price-point ladder (the discount snaps to the nearest App Store
 * price point), a finite `numberOfPeriods` (so "forever" is capped at 12), and
 * this resolves the USA price point — additional territories need a follow-up.
 */

const OFFER_PERIOD_CAP = 12 // "forever" cap — Apple intro offers are finite

/** base billing interval → Apple intro-offer duration enum. */
function ascPeriodDuration(interval: string | null): string {
  switch ((interval ?? "month").toLowerCase()) {
    case "year": return "ONE_YEAR"
    case "week": return "ONE_WEEK"
    case "day": return "THREE_DAYS"
    default: return "ONE_MONTH"
  }
}

export async function syncCouponToAppStore(opts: {
  tenantId: string
  couponRowId: string
  code: string
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  appliesToProductIds: string[] | null
}): Promise<{ offerIdsByProduct: Record<string, string> } | null> {
  const supabase = createClient()

  // 1. App Store connected + decrypt the .p8 + issuer/key ids.
  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: opts.tenantId, p_provider: "app_store" })
    .single<{ connected: boolean; config: Record<string, any> }>()
  if (!status?.connected) return null

  const { data: decrypted } = await supabase
    .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: opts.tenantId, p_provider: "app_store" })
    .single<{ credential: string | null; config: Record<string, any> }>()
  const cfg = decrypted?.config ?? {}
  if (!decrypted?.credential || !cfg.key_id || !cfg.issuer_id || !cfg.bundle_id) return null
  const bundleId = cfg.bundle_id as string

  const creds: AppStoreConnectCreds = {
    keyId: cfg.key_id,
    issuerId: cfg.issuer_id,
    privateKeyP8: decrypted.credential,
  }
  const token = await appStoreConnectToken(creds)

  // 2. Applicable subscription products synced to the App Store.
  let q = supabase
    .from("tenant_products")
    .select("id, app_store_product_id, interval, type")
    .eq("tenant_id", opts.tenantId)
    .eq("type", "subscription")
    .not("app_store_product_id", "is", null)
  if (opts.appliesToProductIds && opts.appliesToProductIds.length > 0) {
    q = q.in("id", opts.appliesToProductIds)
  }
  const { data: products } = await q
  if (!products || products.length === 0) return { offerIdsByProduct: {} }

  const { data: pricing } = await supabase
    .from("tenant_pricing")
    .select("product_id, amount_cents, currency")
    .in("product_id", products.map((p) => p.id))
  // USD base price per product (Apple price points resolved in USA).
  const usdByProduct = new Map<string, number>()
  for (const row of pricing ?? []) {
    if (String(row.currency).toUpperCase() === "USD" && !usdByProduct.has(row.product_id)) {
      usdByProduct.set(row.product_id, row.amount_cents)
    }
  }

  const numberOfPeriods =
    opts.duration === "once" ? 1 : opts.duration === "repeating" ? opts.durationInMonths ?? 1 : OFFER_PERIOD_CAP

  const offerIdsByProduct: Record<string, string> = {}
  for (const prod of products) {
    const baseCents = usdByProduct.get(prod.id)
    if (!baseCents) continue // no USD price to discount against

    // Resolve the ASC RESOURCE id from the stored product reference id — the
    // pricePoints / introductoryOffers endpoints 404 on the reference name.
    const subId = await resolveAscSubscriptionId(token, bundleId, prod.app_store_product_id as string)
    if (!subId) {
      console.warn(`[appstore-coupon-sync] could not resolve ASC subscription for ${prod.app_store_product_id}`)
      continue
    }
    const targetUsd = Math.max(0.01, (baseCents * (1 - opts.percentOff / 100)) / 100)

    // Resolve the nearest USA price point to the discounted amount.
    const ppRes = await ascFetch(token, `/v1/subscriptions/${subId}/pricePoints?filter[territory]=USA&limit=200`)
    if (!ppRes.ok) {
      console.warn(`[appstore-coupon-sync] pricePoints lookup failed for ${subId} (${ppRes.status})`)
      continue
    }
    const points: any[] = (await ppRes.json()).data ?? []
    if (points.length === 0) continue
    let best = points[0]
    let bestDelta = Number.POSITIVE_INFINITY
    for (const point of points) {
      const price = parseFloat(point?.attributes?.customerPrice ?? "NaN")
      if (!Number.isFinite(price)) continue
      const delta = Math.abs(price - targetUsd)
      if (delta < bestDelta) { bestDelta = delta; best = point }
    }

    // Idempotent-ish: skip if a non-free intro offer already exists for this sub.
    const listRes = await ascFetch(token, `/v1/subscriptions/${subId}/introductoryOffers?limit=20`)
    if (listRes.ok) {
      const has = ((await listRes.json()).data ?? []).some(
        (o: any) => o?.attributes?.offerMode === "PAY_AS_YOU_GO",
      )
      if (has) { offerIdsByProduct[prod.id] = `${subId}-pay-as-you-go`; continue }
    }

    const createRes = await ascFetch(token, `/v1/subscriptionIntroductoryOffers`, {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "subscriptionIntroductoryOffers",
          attributes: {
            offerMode: "PAY_AS_YOU_GO",
            duration: ascPeriodDuration(prod.interval ?? null),
            numberOfPeriods,
            startDate: null,
          },
          relationships: {
            subscription: { data: { type: "subscriptions", id: subId } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: best.id } },
            // Apple requires an explicit territory relationship (409 without it); the
            // resolved price point is a USA point, so scope the offer to USA to match.
            territory: { data: { type: "territories", id: "USA" } },
          },
        },
      }),
    })
    if (!createRes.ok) {
      console.error(
        `[appstore-coupon-sync] introductoryOffers.create failed for ${subId} (${createRes.status}): ${(await createRes.text()).slice(0, 200)}`,
      )
      continue
    }
    const created = await createRes.json()
    offerIdsByProduct[prod.id] = created?.data?.id ?? `${subId}-pay-as-you-go`
  }

  if (Object.keys(offerIdsByProduct).length > 0) {
    await supabase
      .from("tenant_coupons")
      .update({ appstore_offer_ids: offerIdsByProduct, updated_at: new Date().toISOString() })
      .eq("id", opts.couponRowId)
  }
  return { offerIdsByProduct }
}

export async function syncCouponBestEffort(args: Parameters<typeof syncCouponToAppStore>[0]) {
  try {
    await syncCouponToAppStore(args)
  } catch (e: any) {
    console.error("[appstore-coupon-sync] failed:", e?.message ?? e)
  }
}
