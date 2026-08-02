package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * The Google-Play-compliance routing decision (Payments policy). This is the single point that
 * decides whether an Android digital checkout goes through Google Play Billing or falls back to a
 * web payment page — the exact decision that got a consumer app flagged when it opened Stripe.
 *
 * The enforced cases (VERIFY): Android+digital+playProductId → Google Play native; iOS/macOS+
 * digital+appStoreProductId → StoreKit native (Apple Guideline 3.1.1); web/desktop → web (openUrl);
 * a native-store digital good with a missing product id → BLOCKED (no web fallback, error). Plus: a
 * PHYSICAL good is still allowed the web lane on every platform.
 */
class CheckoutRoutingTest {

    private fun plan(
        playProductId: String? = "paycraft_monthly",
        appStoreProductId: String? = "com.paycraft.monthly",
        isDigital: Boolean = true,
    ) = BillingPlan(
        id = "monthly",
        name = "Monthly",
        price = "$9.99",
        interval = "month",
        rank = 0,
        playProductId = playProductId,
        appStoreProductId = appStoreProductId,
        isDigital = isDigital,
    )

    @Test
    fun androidDigitalWithPlayProductId_routesToNativePlay() {
        val lane = resolveCheckoutLane(platform = "android", plan = plan(playProductId = "paycraft_monthly"))
        val native = assertIs<CheckoutLane.NativePlay>(lane)
        assertEquals("paycraft_monthly", native.productId)
    }

    @Test
    fun iosDigitalWithAppStoreProductId_routesToNativeStoreKit() {
        // Apple Guideline 3.1.1: an iOS digital subscription MUST transact through StoreKit IAP,
        // never a web payment page.
        val lane = resolveCheckoutLane(platform = "ios", plan = plan(appStoreProductId = "com.paycraft.monthly"))
        val native = assertIs<CheckoutLane.NativeStoreKit>(lane)
        assertEquals("com.paycraft.monthly", native.productId)
    }

    @Test
    fun macosDigitalWithAppStoreProductId_routesToNativeStoreKit() {
        // macOS shares the App Store / StoreKit lane with iOS.
        val lane = resolveCheckoutLane(platform = "macos", plan = plan(appStoreProductId = "com.paycraft.monthly"))
        val native = assertIs<CheckoutLane.NativeStoreKit>(lane)
        assertEquals("com.paycraft.monthly", native.productId)
    }

    @Test
    fun iosDigitalWithMissingAppStoreProductId_isBlockedNotWeb() {
        // ANTI-STEERING (Apple 3.1.1): a misconfigured product must NOT fall back to the browser on iOS.
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("ios", plan(appStoreProductId = null)))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("ios", plan(appStoreProductId = "")))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("ios", plan(appStoreProductId = "   ")))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("macos", plan(appStoreProductId = null)))
    }

    @Test
    fun webPlatform_routesToWebCheckout() {
        // A platform with no native store keeps the existing web payment link (openUrl path).
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "web", plan = plan()))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane(platform = "desktop", plan = plan()))
    }

    @Test
    fun androidDigitalWithMissingPlayProductId_isBlockedNotWeb() {
        // ANTI-STEERING: a misconfigured product must NOT fall back to the browser on Android.
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = null)))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = "")))
        assertIs<CheckoutLane.Misconfigured>(resolveCheckoutLane("android", plan(playProductId = "   ")))
    }

    @Test
    fun physicalGood_isAllowedWebLane() {
        // A genuinely physical product is permitted the external payment page on every platform.
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("android", plan(isDigital = false)))
        assertIs<CheckoutLane.Web>(resolveCheckoutLane("ios", plan(isDigital = false)))
    }

    @Test
    fun platformMatchIsCaseInsensitive() {
        assertIs<CheckoutLane.NativePlay>(resolveCheckoutLane("Android", plan()))
        assertIs<CheckoutLane.NativeStoreKit>(resolveCheckoutLane("iOS", plan()))
    }
}
