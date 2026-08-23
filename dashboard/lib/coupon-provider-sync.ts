import { syncCouponBestEffort as stripeSync } from "./stripe-coupon-sync"
import { syncCouponBestEffort as razorpaySync } from "./razorpay-coupon-sync"
import { syncCouponBestEffort as googlePlaySync } from "./googleplay-coupon-sync"
import { syncCouponBestEffort as appStoreSync } from "./appstore-coupon-sync"

/**
 * Generic coupon → provider fan-out.
 *
 * A PayCraft coupon applies to EVERY connected provider by default. Each adapter
 * is best-effort and self-skips when the tenant hasn't connected that provider,
 * so there is no per-route wiring and no "which providers?" decision — adding a
 * provider is one line in PROVIDER_COUPON_ADAPTERS. Stripe/Razorpay create a
 * single coupon/offer; Google Play/App Store create a discounted subscription
 * offer per applicable product (see the respective *-coupon-sync modules).
 */

export interface CouponSyncArgs {
  tenantId: string
  couponRowId: string
  code: string
  name: string | null
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  maxRedemptions: number | null
  redeemBy: string | null
  appliesToProductIds: string[] | null
}

interface CouponAdapter {
  provider: string
  run: (args: CouponSyncArgs) => Promise<void>
}

// The single source of truth for where coupons sync. Every connected provider
// gets the coupon; unconnected ones no-op inside their adapter.
export const PROVIDER_COUPON_ADAPTERS: CouponAdapter[] = [
  {
    provider: "stripe",
    run: (a) =>
      stripeSync({ ...a, existingStripeCouponId: null, existingStripePromotionCodeId: null }),
  },
  {
    provider: "razorpay",
    run: (a) => razorpaySync({ ...a, existingRazorpayOfferId: null }),
  },
  { provider: "google_play", run: (a) => googlePlaySync(a) },
  { provider: "app_store", run: (a) => appStoreSync(a) },
]

/** Fan a coupon out to every provider adapter concurrently (all best-effort). */
export async function syncCouponToAllProviders(args: CouponSyncArgs): Promise<void> {
  await Promise.all(PROVIDER_COUPON_ADAPTERS.map((adapter) => adapter.run(args)))
}
