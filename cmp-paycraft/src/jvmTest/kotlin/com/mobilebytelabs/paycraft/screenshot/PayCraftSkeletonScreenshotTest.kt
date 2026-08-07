/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * AC-15 — device-free Roborazzi golden gate for the PayCraft paywall surface.
 *
 * Renders three cmp-paycraft composables into a Skiko-desktop composition, captures a
 * PNG snapshot via Roborazzi's `captureRoboImage(SemanticsNodeInteraction, filePath, …)`,
 * and pins that PNG under `src/jvmTest/resources/screenshots/` as a committed golden.
 * `verifyRoborazziJvm` re-renders and byte-compares against the golden → non-zero exit on
 * any drift (RULE-DESIGN-CONFORMANCE-001 IA3-9 equivalent for a Skiko-render surface).
 *
 * Why explicit `@Test` capture (no ComposablePreviewScanner):
 *   • The 03-shimmer-productlist plan asks for a *device-free acceptance gate*, not a
 *     preview-discovery harness. Explicit tests give us three deterministic captures
 *     with named goldens (skeleton / paywall_content / product_list) and let each
 *     test assert the capture actually happened (non-vacuous guard against
 *     RULE-DESIGN-CONFORMANCE IA3-9 "compiles-but-renders-wrong").
 *   • The scanner path additionally requires the `roborazzi-compose-preview-scanner-support`
 *     runtime — that artifact is Android-only, so pulling it into jvmTest would either
 *     leak Android classes into the Skiko-desktop lane or fail to resolve. Explicit
 *     tests need only `roborazzi-compose-desktop` on jvmTest.
 *
 * Golden-write layout:
 *   `cmp-paycraft/src/jvmTest/resources/screenshots/<name>.png`
 * (COMMITTED — the `verifyRoborazziJvm` task compares against these paths.)
 *
 * How to run:
 *   ./gradlew :cmp-paycraft:recordRoborazziJvm --no-configuration-cache   # (re)generate
 *   ./gradlew :cmp-paycraft:verifyRoborazziJvm --no-configuration-cache   # gate
 *
 * The `--no-configuration-cache` flag is deliberate — Roborazzi's Gradle plugin captures
 * `Project` in one of its provider chains today, which the config cache rejects. Same
 * escape hatch used by the reference recipe (roborazzi-desktop-render-tier-recipe, 2026-08-06).
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.templates.BrandedStackTemplate
import com.mobilebytelabs.paycraft.ui.ProductList
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Explicit Roborazzi capture harness for the Phase-3 paywall surface (AC-15).
 *
 * Three deterministic captures, each in its own `runComposeUiTest` block (fresh
 * composition per test → no cross-test contamination). Every test wraps the target
 * composable in [PayCraftThemeProvider] and a fixed light [MaterialTheme] so the
 * golden is stable across JDKs / desktop themes / OS palettes.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftSkeletonScreenshotTest {

    /**
     * Golden #1 — Loading state: the layout-matched [PaywallSkeleton] with three plan
     * placeholders + shimmer degraded to a static background (`reduceMotion = true`)
     * so the capture is deterministic. Matches the Phase-3 shape parity test
     * (`ProductListShimmerParityTest.skeleton_item_count_matches_requested_count`).
     */
    @Test
    fun skeleton_render() = runComposeUiTest {
        setContent {
            DeterministicPayCraftTheme {
                PaywallSkeleton(planCount = 3, reduceMotion = true)
            }
        }
        // Roborazzi's captureRoboImage on a SemanticsNodeInteraction snapshots the
        // whole composition rooted at that node — `onRoot()` = the full skeleton.
        onRoot().captureRoboImage("src/jvmTest/resources/screenshots/paywall_skeleton.png")
        assertCapturedFileExists("src/jvmTest/resources/screenshots/paywall_skeleton.png")
    }

    /**
     * Golden #2 — Content state: the branded paywall's Free branch with the same
     * deterministic product list. Exercises the whole BrandedStackTemplate composition
     * (hero → value props → plan stack → CTA → footer) as the user sees it, so a
     * regression to any of those surfaces flips the golden.
     */
    @Test
    fun content_paywall_render() = runComposeUiTest {
        setContent {
            DeterministicPayCraftTheme(config = deterministicSuiteConfig()) {
                BrandedStackTemplate(
                    state = BillingState.Free,
                    products = deterministicProducts(),
                    onPickProduct = { /* deterministic no-op — golden is a static frame */ },
                    onRetry = { /* deterministic no-op */ },
                )
            }
        }
        onRoot().captureRoboImage("src/jvmTest/resources/screenshots/paywall_content.png")
        assertCapturedFileExists("src/jvmTest/resources/screenshots/paywall_content.png")
    }

    /**
     * Golden #3 — `ui/ProductList.kt` in isolation: three plans (monthly + annual with
     * savings badge + trial), the annual plan marked recommended (`recommendedSku =
     * "annual"`), the CTA pinned. Isolating the surface protects the addressable
     * plans contract (AC-7) from a regression that only touches ProductList without
     * touching the paywall template.
     */
    @Test
    fun product_list_render() = runComposeUiTest {
        setContent {
            DeterministicPayCraftTheme(config = deterministicSuiteConfig()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(16.dp),
                ) {
                    ProductList(
                        products = deterministicProducts(),
                        onPurchase = { /* deterministic no-op */ },
                        recommendedSku = "annual",
                    )
                }
            }
        }
        onRoot().captureRoboImage("src/jvmTest/resources/screenshots/product_list.png")
        assertCapturedFileExists("src/jvmTest/resources/screenshots/product_list.png")
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Deterministic PayCraft theme wrapper — pins the light [lightColorScheme] and the
     * default [MaterialTheme.typography] so goldens don't change across JDKs / desktop
     * themes. `PayCraftThemeProvider` then derives the PayCraft tokens against that
     * fixed scheme (this is the exact `config-wins-else-host-inherit` path AC-2
     * documents; a null `config` here means the host-inherit branch is exercised).
     */
    @Composable
    private fun DeterministicPayCraftTheme(config: SuiteConfig? = null, content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 891.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                if (config == null) {
                    PayCraftThemeProvider(content = content)
                } else {
                    // The Content and ProductList paths read PaywallDto through
                    // LocalPayCraftConfig — providing a static SuiteConfig makes the
                    // paywall render its full copy set (hero title/subtitle, CTA
                    // label) instead of the LocalPayCraftConfig-null defaults.
                    androidx.compose.runtime.CompositionLocalProvider(
                        LocalPayCraftConfig provides config,
                    ) {
                        PayCraftThemeProvider(config = config, content = content)
                    }
                }
            }
        }
    }

    /**
     * Static 3-plan catalog used by [content_paywall_render] + [product_list_render].
     * A monthly baseline + an annual plan (drives the "SAVE X%" badge + "per month
     * billed annually" anchor line) + a trial linked to the annual plan (drives the
     * trial-eligibility badge). SKUs are stable so the recommended-ring resolves
     * against `paywall.popularPlanSku = "annual"` deterministically.
     */
    private fun deterministicProducts(): List<Product> = listOf(
        Product.Subscription(
            id = "prod_monthly",
            sku = "monthly",
            displayName = "Monthly",
            displayOrder = 0,
            interval = Product.Subscription.Interval.MONTH,
            basePrice = Money(amountMinor = 499, currency = "USD"),
        ),
        Product.Subscription(
            id = "prod_annual",
            sku = "annual",
            displayName = "Annual",
            displayOrder = 1,
            interval = Product.Subscription.Interval.YEAR,
            basePrice = Money(amountMinor = 3999, currency = "USD"),
        ),
        Product.Trial(
            id = "prod_trial",
            sku = "trial",
            displayName = "Free trial",
            displayOrder = 2,
            durationDays = 7,
            attachesToProductId = "prod_annual",
        ),
    )

    /**
     * Static [SuiteConfig] wrapping the [PaywallDto] the Free-branch paywall reads
     * to render its title/subtitle/CTA copy + the recommended-plan ring.
     */
    private fun deterministicSuiteConfig(): SuiteConfig = SuiteConfig(
        tenantId = "screenshot-tenant",
        paywall = PaywallDto(
            heroTitle = "Upgrade to Premium",
            heroSubtitle = "Ad-free experience, HD downloads, and exclusive features.",
            ctaContinue = "Continue",
            popularPlanSku = "annual",
        ),
    )

    /**
     * Non-vacuous capture guard — asserts the golden file actually exists on disk
     * after the capture call returns. Roborazzi's `captureRoboImage` is
     * fire-and-forget; without this check a swallowed IO error would pass this
     * test AND produce a `total: 0` verify summary (a vacuous green — the exact
     * class the memory recipe warns about).
     */
    private fun assertCapturedFileExists(relativePath: String) {
        val file = java.io.File(relativePath)
        assertTrue(
            file.exists() && file.length() > 0L,
            "captureRoboImage did not write $relativePath — verifyRoborazziJvm would be vacuously green",
        )
    }
}
