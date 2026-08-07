/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Product-list Loading-branch placeholder — the layout-matched shimmer stand-in
 * for the loaded [com.mobilebytelabs.paycraft.ui.ProductList] surface. Child
 * count and per-item shape mirror the loaded plan-card layout one-to-one so the
 * paywall opens without any visible layout shift when Content composes over the
 * shimmer (AC-6).
 */
package com.mobilebytelabs.paycraft.ui.components.skeleton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.shimmer.shimmerWave

/**
 * Layout-matched placeholder for the loaded [com.mobilebytelabs.paycraft.ui.ProductList]
 * surface. Emits exactly [count] item placeholders — same child count and shape as
 * the loaded product list, so the paywall opens without any visible layout shift when
 * Content composes over the shimmer (AC-6 parity guarantee).
 *
 * Every placeholder animates via [Modifier.shimmerWave] which reads
 * [androidx.compose.material3.MaterialTheme.colorScheme.surfaceVariant] /
 * `surface`, so the shimmer inherits the host theme automatically (no
 * design-system coupling).
 *
 * @param count        Number of placeholder rows — the paywall passes the loaded
 *                     product count so shimmer↔content shape parity holds (AC-6).
 * @param reduceMotion When `true` collapses the shimmer to a static background,
 *                     staying a visible placeholder on OS reduce-motion (AC-14).
 * @param modifier     Layout modifier applied to the root column.
 */
@Composable
fun ProductListSkeleton(count: Int, reduceMotion: Boolean = false, modifier: Modifier = Modifier) {
    val rowShape = RoundedCornerShape(12.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag(PayCraftTestTags.PRODUCT_LIST_SHIMMER)
            .semantics {
                contentDescription = "Loading plans"
                stateDescription = "loading"
            },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Emit exactly `count` placeholders — shape parity with the loaded ProductList
        // row height + padding, so a paywall that renders 3 plans on load shows 3
        // shimmer rows here (never 5-then-3 or a single vague spinner).
        repeat(count) { index ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(72.dp)
                    .testTag(PayCraftTestTags.PRODUCT_LIST_ITEM_SHIMMER)
                    .semantics { contentDescription = "Loading plan ${index + 1}" }
                    .shimmerWave(shape = rowShape, reduceMotion = reduceMotion),
            )
        }
    }
}
