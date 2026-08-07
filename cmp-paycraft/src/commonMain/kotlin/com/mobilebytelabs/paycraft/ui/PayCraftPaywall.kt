package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import org.koin.compose.viewmodel.koinViewModel

/**
 * PayCraft paywall — the SINGLE public entry point for the SDK's paywall UI
 * (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Renders either a [DisplayMode.FullScreen] paywall (default) or a compact
 * [DisplayMode.Banner] status strip — both observe the same [PayCraftPaywallViewModel]
 * and react to the same `BillingState`. Hosts pick the shape that fits the surface
 * they're rendering on.
 *
 * Every render path lives inside [PayCraftPaywallComposable] — the v2 cloud-template
 * pipeline that resolves [com.mobilebytelabs.paycraft.presentation.PaywallTemplate]
 * (BrandedStackTemplate by default) and renders every
 * [com.mobilebytelabs.paycraft.model.BillingState] branch. The retired v1
 * `v1 hand-built content branch` hand-built `when`-over-`BillingState` is DELETED — its
 * behaviour is fully absorbed into [PayCraftPaywallComposable] plus the
 * `BrandedStackTemplate`'s `DeviceConflict` / `OwnershipVerified` branches so no
 * user-visible state is dropped.
 *
 * Phase 3 (AC-5, AC-14): every `BillingState.Loading` branch in the single paywall
 * path now renders a layout-matched
 * [com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton] instead of
 * a centered progress indicator — the skeleton mirrors the loaded template layout
 * one-to-one (hero + subtitle + plans grid + CTA), animates through
 * [com.mobilebytelabs.paycraft.ui.components.shimmer.Modifier.shimmerWave], and
 * degrades to a static background under OS reduce-motion. The Content branch
 * delegates to [ProductList] for its plans surface (AC-7). Warm-cache paywalls
 * skip the skeleton entirely because [com.mobilebytelabs.paycraft.PayCraft.initialize]
 * prefetches products fire-and-forget (AC-8).
 *
 * Banner-mode callers should treat [onDismiss] as "user tapped the banner" — typically
 * a signal to show the full-screen paywall in a sheet or dialog.
 *
 * @param onDismiss   Invoked when the paywall dismisses (close button, viewmodel event,
 *                    banner tap). Hosts wire this to close their sheet/dialog wrapper.
 * @param modifier    Optional modifier applied to the root surface.
 * @param displayMode [DisplayMode.FullScreen] (default) or [DisplayMode.Banner].
 * @param viewModel   ViewModel — Koin-injected by default so consumers rarely pass one.
 */
@Composable
fun PayCraftPaywall(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    displayMode: DisplayMode = DisplayMode.FullScreen,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    // Removed: v1 hand-built content branch(state = …, onDismiss = …, …) hand-built branch.
    // Single paywall path — PayCraftPaywallComposable resolves BrandedStackTemplate.
    PayCraftPaywallComposable(
        onDismiss = onDismiss,
        displayMode = displayMode,
        modifier = modifier,
        viewModel = viewModel,
    )
}

/**
 * Bottom-sheet variant of the paywall. Preserves the retired v1 behaviour:
 * `dragHandle = null` (no drag chrome) and [PayCraftPaywallAction.RefreshStatus]
 * on the sheet's `onDismissRequest` so a subscription state stale at open time
 * gets re-checked when the user closes without purchasing.
 *
 * Internally delegates to [PayCraftPaywallComposable] — the single paywall path —
 * so the sheet renders through the same v2 template pipeline as [PayCraftPaywall].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = {
            // Preserved from v1: force a status refresh on close so a stale subscription
            // state (e.g. purchase completed in the browser tab) is re-fetched before
            // the host observes billingState next.
            viewModel.dispatch(PayCraftPaywallAction.RefreshStatus)
            onDismiss()
        },
        sheetState = sheetState,
        dragHandle = null,
        modifier = modifier,
    ) {
        PayCraftPaywallComposable(
            onDismiss = onDismiss,
            displayMode = DisplayMode.FullScreen,
            viewModel = viewModel,
        )
    }
}
