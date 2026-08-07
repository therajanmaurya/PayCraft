package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.persistence.CheckoutSuccessFlag
import com.mobilebytelabs.paycraft.ui.theme.PayCraftTheme

/**
 * Post-purchase celebration sheet shown after a Free → Premium subscription
 * activation event. Reads `success_title` / `success_message` /
 * `success_cta_label` from the dashboard-configured [PaywallDto] v2 fields.
 *
 * **Once-per-(session × SKU)** — the sheet shows the first time the consumer
 * activates `activatedSku` in this `sessionId`, and is suppressed on
 * subsequent calls (via [CheckoutSuccessFlag], a multiplatform-settings flag
 * keyed `paycraft_success_shown_{sku}_{session_id}`). This prevents the
 * sheet from re-appearing if the host app re-renders after the user dismisses
 * it.
 *
 * Typical wiring from a consumer app:
 * ```kotlin
 * // After PayCraftBillingManager state transitions Free → Premium:
 * if (newPremium != null) {
 *     PayCraftCheckoutSuccessSheet(
 *         activatedSku = newPremium.sku,
 *         sessionId = appSessionId,
 *         onCtaTap = { successSheetVisible.value = false; navigateHome() },
 *         onDismiss = { successSheetVisible.value = false },
 *     )
 * }
 * ```
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftCheckoutSuccessSheet(
    activatedSku: String,
    sessionId: String,
    onCtaTap: () -> Unit,
    onDismiss: () -> Unit,
) {
    val flag = remember { CheckoutSuccessFlag.get() }
    val shouldShow = remember(activatedSku, sessionId) {
        !flag.wasSuccessShown(activatedSku, sessionId)
    }
    if (!shouldShow) {
        // Suppression — fire onDismiss immediately so the host's
        // visibility-state doesn't get stuck waiting on a sheet that never
        // renders. Idempotent because flag.markSuccessShown was already
        // called on the prior invocation.
        LaunchedEffect(activatedSku, sessionId) { onDismiss() }
        return
    }

    val tokens = PayCraftTheme
    val paywall = LocalPayCraftConfig.current?.paywall ?: PaywallDto()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = {
            flag.markSuccessShown(activatedSku, sessionId)
            onDismiss()
        },
        sheetState = sheetState,
        containerColor = tokens.colors.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = tokens.colors.accent,
                modifier = Modifier.size(72.dp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = paywall.successTitle,
                color = tokens.colors.onSurface,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Text(
                text = paywall.successMessage,
                color = tokens.colors.onSurfaceVariant,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    flag.markSuccessShown(activatedSku, sessionId)
                    onCtaTap()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(26.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = tokens.colors.accent,
                    contentColor = tokens.colors.onAccent,
                ),
            ) {
                Text(
                    text = paywall.successCtaLabel,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/**
 * Post-checkout continuation variant — renders [PayCraftCheckoutSuccessSheet]
 * first, and once the user taps the CTA (or the sheet dismisses) transitions to
 * the full paywall via [PayCraftPaywallComposable]. Use this for tier-ladder
 * flows where a successful entry-tier purchase should immediately expose the
 * next-tier upgrade options (annual → lifetime, monthly → annual) inside the
 * same session — a pattern shipped by RevenueCat's post-checkout upsell.
 *
 * Delegates through [PayCraftPaywallComposable] so the paywall renders through
 * the single v2 template path (Phase-2 clean-SDK consolidation, AC-4).
 *
 * @param activatedSku SKU the user just activated — same contract as
 *                     [PayCraftCheckoutSuccessSheet].
 * @param sessionId    Session identifier used by [CheckoutSuccessFlag] for
 *                     once-per-session suppression.
 * @param onFinalDismiss Called after the paywall dismisses (or after the success
 *                       sheet dismisses when [showUpgradePaywall] is false).
 * @param showUpgradePaywall When true (default) the paywall opens after CTA tap.
 *                           Set false to skip the upsell and fire [onFinalDismiss]
 *                           straight from the success CTA.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftCheckoutSuccessSheetOrPaywall(
    activatedSku: String,
    sessionId: String,
    onFinalDismiss: () -> Unit,
    showUpgradePaywall: Boolean = true,
) {
    var upsellVisible by remember(activatedSku, sessionId) { mutableStateOf(false) }

    if (upsellVisible) {
        PayCraftPaywallComposable(
            onDismiss = {
                upsellVisible = false
                onFinalDismiss()
            },
            displayMode = DisplayMode.FullScreen,
        )
    } else {
        PayCraftCheckoutSuccessSheet(
            activatedSku = activatedSku,
            sessionId = sessionId,
            onCtaTap = {
                if (showUpgradePaywall) {
                    upsellVisible = true
                } else {
                    onFinalDismiss()
                }
            },
            onDismiss = onFinalDismiss,
        )
    }
}
