/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Layer 4 of the resilience chain: the last-resort paywall.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.Product

/**
 * Rendered when network, persisted cache and bundled fallback have all failed, but the SDK can
 * still name at least one product.
 *
 * WHY THIS IS A PAYWALL AND NOT AN ERROR SCREEN
 * A user who arrived here wants to buy something. Config resolution failing is our problem, not
 * theirs, and showing an error where a purchase button belongs converts an infrastructure blip
 * into lost revenue and a worse experience than a plain list of plans. So this renders the
 * minimum honest thing: what the plans are, a way to buy, and a way to retry.
 *
 * It is deliberately unstyled beyond the theme — no hero, no template, no remote copy. Everything
 * that would have made it prettier is exactly the data that is missing.
 */
@Composable
fun BuiltInPaywall(
    products: List<Product>,
    onPickProduct: (Product) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Upgrade",
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "We could not load the latest plan details, so this is a simplified view. " +
                "Your purchase still works normally.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        products.sortedBy { it.displayOrder }.forEach { product ->
            Button(
                onClick = { onPickProduct(product) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                // Price comes from whatever the SDK last knew. A Trial carries no price at all, so
                // it shows its name and duration — never a fabricated number, because a wrong price
                // on a purchase button is far worse than no price.
                val label = when (product) {
                    is Product.Subscription -> "${product.displayName} — ${product.basePrice.format()}"
                    is Product.Lifetime -> "${product.displayName} — ${product.basePrice.format()}"
                    is Product.Trial -> "${product.displayName} — ${product.durationDays}-day trial"
                }
                Text(label)
            }
        }

        OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
            Text("Reload plans")
        }
    }
}
