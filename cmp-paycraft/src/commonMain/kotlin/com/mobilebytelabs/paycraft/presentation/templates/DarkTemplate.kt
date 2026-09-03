package com.mobilebytelabs.paycraft.presentation.templates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.presentation.components.PlanCard
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.paywallRoot
import com.mobilebytelabs.paycraft.ui.theme.PayCraftBrandColorsDark

/**
 * Dark template — uses [PayCraftBrandColorsDark] palette (the PayCraft brand
 * dark scheme), elevated surface on a near-black background, high-contrast
 * typography.
 */
@Composable
fun DarkTemplate(state: BillingState, products: List<Product>, onPick: (Product) -> Unit, onRetry: () -> Unit) {
    val bg = PayCraftBrandColorsDark.background
    val onBg = PayCraftBrandColorsDark.onBackground
    Box(
        Modifier
            .paywallRoot(bg)
            .padding(20.dp),
    ) {
        when (state) {
            is BillingState.Loading -> DarkLoading(onBg)
            is BillingState.Free -> DarkFree(products, onPick, onBg)
            is BillingState.Premium -> DarkActive(state, onBg)
            is BillingState.Error -> DarkError(state.message, onRetry, onBg)
            is BillingState.DeviceConflict -> DarkDeviceConflict(state, onBg)
            is BillingState.OwnershipVerified -> DarkOwnershipVerified(state, onBg)
        }
    }
}

@Composable
private fun DarkLoading(@Suppress("UNUSED_PARAMETER") textColor: Color) {
    // Phase 3 (AC-5, AC-14): shared PaywallSkeleton — the deprecated Dark template's
    // Loading branch now delegates to the same layout-matched skeleton so no
    // CircularProgressIndicator remains on any state=Loading path in the SDK.
    // The `textColor` parameter is kept for backward-compat signature stability
    // (the deprecated DarkTemplate signature is still shipped for 3.0 removal).
    PaywallSkeleton(planCount = 3)
}

@Composable
private fun DarkFree(products: List<Product>, onPick: (Product) -> Unit, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            "Upgrade to Premium",
            style = MaterialTheme.typography.headlineLarge,
            color = textColor,
        )
        products.forEach { p -> PlanCard(product = p, onClick = { onPick(p) }) }
    }
}

@Composable
private fun DarkActive(s: BillingState.Premium, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "You're Premium",
            style = MaterialTheme.typography.headlineLarge,
            color = textColor,
        )
        s.trial?.let { Text("Trial ends in ${it.daysRemaining} days", color = textColor) }
        Text("Plan: ${s.status.plan}", color = textColor)
        Text("Renews ${s.status.expiresAt}", color = textColor)
    }
}

@Composable
private fun DarkError(msg: String, onRetry: () -> Unit, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Something went wrong",
            style = MaterialTheme.typography.headlineLarge,
            color = textColor,
        )
        Text(msg, color = textColor)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun DarkDeviceConflict(s: BillingState.DeviceConflict, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Subscription bound to another device",
            style = MaterialTheme.typography.titleLarge,
            color = textColor,
        )
        Text("Last seen on ${s.conflictingDeviceName ?: "another device"}", color = textColor)
        Text("Email: ${s.email}", color = textColor)
    }
}

@Composable
private fun DarkOwnershipVerified(s: BillingState.OwnershipVerified, textColor: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Verified via ${s.verifiedVia.name.lowercase()}",
            style = MaterialTheme.typography.titleLarge,
            color = textColor,
        )
        Text("Transferring subscription to this device…", color = textColor)
    }
}
