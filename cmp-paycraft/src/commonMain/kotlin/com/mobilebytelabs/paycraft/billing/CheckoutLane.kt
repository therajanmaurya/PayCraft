package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * The store-compliance checkout routing decision (RULE: Payments policy — both stores).
 *
 * A digital subscription bought inside a NATIVE app MUST transact through that store's own in-app
 * billing, never an external web payment page:
 *  - On **Android**, routing the user to an external Stripe/Razorpay web page is the "leads users to
 *    a payment method other than Google Play's billing system" violation that got a consumer app
 *    (Reels Downloader, `com.sensei.social`) flagged and restricted — so Android+digital transacts
 *    through Google Play Billing ([NativePlay]).
 *  - On **iOS/macOS**, the equivalent is **Apple App Store Review Guideline 3.1.1**: apps offering a
 *    digital subscription MUST use Apple's In-App Purchase (StoreKit); steering the user to a web
 *    checkout for the same digital good is a 3.1.1 rejection — so iOS/macOS+digital transacts through
 *    StoreKit ([NativeStoreKit]).
 *
 * This is the single, unit-testable decision point every checkout entry (`PayCraft.checkout` /
 * `checkoutWithProvider`) funnels through, so the browser fallback is structurally unreachable for
 * native digital goods on either store.
 */
sealed interface CheckoutLane {
    /** Android + digital + a configured Play product id → transact via Google Play Billing. */
    data class NativePlay(val productId: String) : CheckoutLane

    /**
     * iOS/macOS + digital + a configured App Store product id → transact via StoreKit in-app
     * purchase (Apple Guideline 3.1.1 — a web checkout for a digital subscription is a rejection).
     */
    data class NativeStoreKit(val productId: String) : CheckoutLane

    /**
     * A genuinely physical product (any platform), OR a digital product on a platform with no native
     * store (web/desktop) → keep the existing web checkout URL.
     */
    data object Web : CheckoutLane

    /**
     * A native-store digital checkout whose product id is not configured (Android+digital with no
     * `play_product_id`, or iOS/macOS+digital with no `app_store_product_id`). The checkout is
     * BLOCKED — we set a billing error and never open the browser (anti-steering keystone: a
     * misconfigured product is NOT a licence to route to the web payment page on a native store).
     */
    data class Misconfigured(val reason: String) : CheckoutLane
}

/**
 * Decide the checkout lane for [plan] on [platform].
 *
 * - `platform == "android"` + [isDigital] + non-blank [BillingPlan.playProductId] → [CheckoutLane.NativePlay].
 * - `platform == "android"` + [isDigital] + blank/null play product id → [CheckoutLane.Misconfigured]
 *   (BLOCKS — no web fallback).
 * - `platform == "ios"` or `"macos"` + [isDigital] + non-blank [BillingPlan.appStoreProductId] →
 *   [CheckoutLane.NativeStoreKit] (Apple Guideline 3.1.1 — digital subs transact via StoreKit IAP).
 * - `platform == "ios"` or `"macos"` + [isDigital] + blank/null App Store product id →
 *   [CheckoutLane.Misconfigured] (BLOCKS — no web fallback, the iOS anti-steering keystone).
 * - `platform == "web"` or `"desktop"` + [isDigital] → [CheckoutLane.Web] (no native store).
 * - any physical product (any platform) → [CheckoutLane.Web].
 *
 * @param platform one of `PlatformInfo.platform` values: `android | ios | macos | desktop | web`.
 */
fun resolveCheckoutLane(platform: String, plan: BillingPlan, isDigital: Boolean = plan.isDigital): CheckoutLane {
    if (!isDigital) return CheckoutLane.Web

    return when {
        platform.equals("android", ignoreCase = true) -> {
            val productId = plan.playProductId
            if (productId.isNullOrBlank()) {
                CheckoutLane.Misconfigured("Google Play product not configured")
            } else {
                CheckoutLane.NativePlay(productId)
            }
        }

        platform.equals("ios", ignoreCase = true) || platform.equals("macos", ignoreCase = true) -> {
            val productId = plan.appStoreProductId
            if (productId.isNullOrBlank()) {
                CheckoutLane.Misconfigured("App Store product not configured")
            } else {
                CheckoutLane.NativeStoreKit(productId)
            }
        }

        // web / desktop (or any other) digital → no native store, keep the web checkout URL.
        else -> CheckoutLane.Web
    }
}
