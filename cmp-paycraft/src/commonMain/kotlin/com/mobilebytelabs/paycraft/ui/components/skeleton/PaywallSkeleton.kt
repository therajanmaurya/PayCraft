/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Paywall Loading-branch placeholder — layout-matched skeleton that stands in for
 * the loaded paywall (hero icon, hero title/subtitle, value-prop list, plans grid,
 * dominant CTA). Replaces every centered `CircularProgressIndicator` that used to
 * live in the paywall Loading branch (AC-5). Rendered on cold-cache paywall opens;
 * warm-cache opens (prefetch on init, AC-8) never see this skeleton.
 */
package com.mobilebytelabs.paycraft.ui.components.skeleton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.shimmer.shimmerWave

/**
 * Full-screen paywall skeleton — the layout-matched stand-in for the loaded
 * BrandedStackTemplate Free-state layout (hero icon tile → hero title → subtitle
 * → plans stack → CTA). Root carries [PayCraftTestTags.PAYWALL_SHIMMER] + a
 * `loading` semantic state description so screen readers announce the loading
 * state (AC-14 accessibility posture).
 *
 * Every child animates via [Modifier.shimmerWave] which reads
 * [androidx.compose.material3.MaterialTheme.colorScheme] tonal roles inherited
 * from the host `MaterialTheme` — so the shimmer visually matches the resolved
 * theme with zero design-system coupling.
 *
 * @param planCount     Number of plan placeholders to render — the paywall passes
 *                      the loaded product count for shimmer↔content shape parity (AC-6).
 * @param reduceMotion  When `true` every shimmer degrades to a static background
 *                      placeholder — no infinite animation on OS reduce-motion (AC-14).
 * @param modifier      Layout modifier applied to the root column.
 */
@Composable
fun PaywallSkeleton(planCount: Int = 3, reduceMotion: Boolean = false, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 24.dp)
            .testTag(PayCraftTestTags.PAYWALL_SHIMMER)
            .semantics {
                contentDescription = "Loading paywall"
                stateDescription = "loading"
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Hero icon tile — matches BrandedStackTemplate.PaywallHeroIcon 72dp square.
        Box(
            modifier = Modifier
                .size(72.dp)
                .shimmerWave(shape = RoundedCornerShape(20.dp), reduceMotion = reduceMotion),
        )
        Spacer(Modifier.height(4.dp))
        // Hero title placeholder (~26.sp title height).
        Box(
            modifier = Modifier
                .fillMaxWidth(0.7f)
                .height(28.dp)
                .shimmerWave(shape = RoundedCornerShape(6.dp), reduceMotion = reduceMotion),
        )
        // Subtitle placeholder (~14.sp body height).
        Box(
            modifier = Modifier
                .fillMaxWidth(0.9f)
                .height(16.dp)
                .shimmerWave(shape = RoundedCornerShape(6.dp), reduceMotion = reduceMotion),
        )
        Spacer(Modifier.height(8.dp))
        // Plans grid — count parity with the loaded product list (AC-6). Fills the
        // remaining vertical space so the CTA stays pinned near the bottom, same as
        // the loaded template.
        ProductListSkeleton(
            count = planCount,
            reduceMotion = reduceMotion,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        // CTA placeholder — matches BrandedStackContinueButton 52dp pill height.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .shimmerWave(shape = RoundedCornerShape(26.dp), reduceMotion = reduceMotion),
        )
    }
}

/**
 * Compact one-line banner skeleton — the layout-matched stand-in for the
 * [com.mobilebytelabs.paycraft.ui.BannerPaywall] compact strip's Loading branch
 * (AC-5). Rendered inline in the banner Row so the strip keeps its height +
 * padding but shows a shimmer instead of a `CircularProgressIndicator`.
 *
 * @param reduceMotion  When `true` collapses to a static background (AC-14).
 * @param modifier      Layout modifier applied to the shimmer row.
 */
@Composable
fun BannerShimmerRow(reduceMotion: Boolean = false, modifier: Modifier = Modifier) {
    // One rounded pill placeholder — same visual weight as the "Checking your
    // subscription…" label + progress indicator it replaces. Fills the row so the
    // banner keeps its intrinsic height when swapping between Loading/Free/Premium.
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(16.dp)
            .testTag(PayCraftTestTags.BANNER_SHIMMER)
            .semantics {
                contentDescription = "Checking subscription"
                stateDescription = "loading"
            }
            .shimmerWave(shape = CircleShape, reduceMotion = reduceMotion),
    )
}
