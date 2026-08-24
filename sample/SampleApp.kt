/*
 * PayCraft Sample — the two integration modes, side by side.
 *
 * Reference sample (not built as a module here). Copy into a KMP Compose target,
 * add `implementation("io.github.mobilebytelabs:cmp-paycraft:LATEST")`, paste the
 * "PayCraft Sample" tenant's pk_test_ key below, and wire SampleApp() into your root.
 *
 * Guide: https://paycraft.mobilebytesensei.com/docs/sdk-integration
 */
package com.mobilebytesensei.paycraftsample

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.ui.PayCraftPaywall

// 1) Initialize once at app startup (Application.kt / MainActivity.kt / AppDelegate).
//    Grab this key from the dashboard: PayCraft Sample → Settings → API keys.
private const val PAYCRAFT_API_KEY = "pk_test_REPLACE_WITH_PAYCRAFT_SAMPLE_KEY"

@Composable
fun SampleApp() {
    LaunchedEffect(Unit) { PayCraft.initialize(apiKey = PAYCRAFT_API_KEY) }

    var headless by remember { mutableStateOf(false) }

    // The whole sample runs inside YOUR MaterialTheme — the drop-in paywall inherits
    // it automatically (mode 1 is "themed to the app" for free).
    MaterialTheme {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Headless mode", Modifier.weight(1f))
                Switch(checked = headless, onCheckedChange = { headless = it })
            }
            HorizontalDivider()
            if (headless) HeadlessSample() else DropInSample()
        }
    }
}

/* ── Mode 1: drop-in paywall (3 lines, themed) ─────────────────────────────── */
@Composable
private fun DropInSample() {
    var showPaywall by remember { mutableStateOf(false) }
    Button(onClick = { showPaywall = true }) { Text("Upgrade (drop-in paywall)") }
    if (showPaywall) {
        PayCraftPaywall(onDismiss = { showPaywall = false })
    }
}

/* ── Mode 2: headless — observe state, render your own UI, drive checkout ────── */
@Composable
private fun HeadlessSample() {
    val billing = PayCraft.billingManager ?: return
    val state by billing.billingState.collectAsState()
    // suiteConfigFlow drives recomposition when the dashboard config lands/updates.
    val config by PayCraft.suiteConfigFlow.collectAsState()

    when (state) {
        is BillingState.Premium -> Text("✓ Premium unlocked — thanks!")
        is BillingState.Loading -> CircularProgressIndicator()
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Choose a plan", style = MaterialTheme.typography.titleMedium)
            // PayCraft.plans is the same list the paywall renders — your own UI:
            PayCraft.plans.forEach { plan ->
                OutlinedButton(onClick = { PayCraft.checkout(plan) }, modifier = Modifier.fillMaxWidth()) {
                    Text("${plan.name} · ${plan.price}")
                }
            }
            if (config?.products.isNullOrEmpty()) Text("Loading plans…", style = MaterialTheme.typography.bodySmall)
        }
    }
}
