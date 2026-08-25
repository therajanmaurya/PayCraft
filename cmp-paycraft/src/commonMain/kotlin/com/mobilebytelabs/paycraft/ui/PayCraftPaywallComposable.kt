package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.model.ProductMapper
import com.mobilebytelabs.paycraft.presentation.PaywallTemplate
import com.mobilebytelabs.paycraft.presentation.ProviderBottomSheet
import com.mobilebytelabs.paycraft.provider.StripeProvider
import com.mobilebytelabs.paycraft.ui.components.skeleton.PaywallSkeleton
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import org.koin.compose.viewmodel.koinViewModel

/**
 * v2 cloud-driven paywall surface — the **single paywall path** for the PayCraft SDK
 * (Phase-2 clean-SDK consolidation, AC-4).
 *
 * Reads tenant config from [LocalPayCraftConfig] (falling back to [PayCraft.suiteConfigFlow]
 * for callers that haven't wrapped with a CompositionLocalProvider), resolves the
 * [PaywallTemplate] enum from `paywall.template` (defaulting to
 * [PaywallTemplate.BRANDED_STACK], the production-grade template that covers every
 * [com.mobilebytelabs.paycraft.model.BillingState] branch including
 * [com.mobilebytelabs.paycraft.model.BillingState.DeviceConflict] and
 * [com.mobilebytelabs.paycraft.model.BillingState.OwnershipVerified]), maps cloud
 * [com.mobilebytelabs.paycraft.config.ProductDto] into the SDK sealed [Product] hierarchy,
 * wraps in [PayCraftThemeProvider] with the live [SuiteConfig] so cloud `theme_jsonb`
 * / `primary_color` overrides win over the host `MaterialTheme.colorScheme` (else
 * host-inherit), and dispatches to the template's `render()`.
 *
 * All the surface chrome the retired v1 [PayCraftPaywall.kt] `v1 hand-built content branch`
 * used to own — the close-button top bar (Scaffold), the test-mode chip, the
 * snackbar host, the provider-picker bottom sheet, and the modal restore sheet —
 * live inside this composable so every downstream public composable
 * ([PayCraftPaywall], [PayCraftPaywallSheet], [BannerPaywall], [PayCraftBanner]'s
 * inline variant, [PayCraftRestore]'s paywall-integrated variant,
 * [PayCraftPremiumGuard]'s inline variant, [PayCraftCheckoutSuccessSheet]'s
 * post-success upsell variant) delegates through this ONE path.
 *
 * Product picks bridge to the existing [PayCraftPaywallAction.SelectPlan] flow via
 * [Product.toBillingPlan] until sub-plan 05's provider-picker work adds a v2-native
 * SelectProduct action.
 *
 * @param onDismiss  Invoked when the paywall's viewmodel emits
 *                   [PayCraftPaywallEvent.Dismissed] (close-button tap, sheet dismiss,
 *                   or a successful restore that navigates away).
 * @param displayMode [DisplayMode.FullScreen] renders a top-bar-plus-template scaffold;
 *                    [DisplayMode.Banner] renders the compact status-strip [BannerPaywall]
 *                    that shares the same [PayCraftPaywallViewModel] state.
 * @param modifier   Optional modifier applied to the root surface.
 * @param viewModel  ViewModel — Koin-injected by default so consumers rarely pass one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayCraftPaywallComposable(
    onDismiss: () -> Unit = {},
    displayMode: DisplayMode = DisplayMode.FullScreen,
    modifier: Modifier = Modifier,
    viewModel: PayCraftPaywallViewModel = koinViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(viewModel.events) {
        viewModel.events.collect { event ->
            when (event) {
                is PayCraftPaywallEvent.Dismissed -> onDismiss()
                is PayCraftPaywallEvent.ErrorOccurred -> snackbarHostState.showSnackbar(event.message)
                else -> {}
            }
        }
    }

    // Config resolution — CompositionLocal (test/host-supplied) wins over the live cloud
    // flow; both fall through to null so PayCraftThemeProvider host-inherits when nothing
    // is configured yet (cold start). Reactive: a dashboard edit publishes on the flow
    // and the paywall recomposes without a cold relaunch (AC-3).
    val liveConfig = LocalPayCraftConfig.current ?: PayCraft.suiteConfigFlow.collectAsState().value

    PayCraftThemeProvider(config = liveConfig) {
        when (displayMode) {
            DisplayMode.Banner -> BannerPaywall(
                state = state.billingState,
                onTap = onDismiss,
                modifier = modifier,
            )
            DisplayMode.FullScreen -> PayCraftPaywallFullScreenSurface(
                state = state,
                config = liveConfig,
                snackbarHostState = snackbarHostState,
                onAction = viewModel::dispatch,
                modifier = modifier,
            )
        }

        // Provider-picker bottom sheet — floats above every display mode so a plan tap
        // in either FullScreen or Banner mode surfaces the picker uniformly. Preserved
        // verbatim from the retired v1 hand-built content branch.
        val sheetTarget = state.providerSheetTarget
        if (sheetTarget != null) {
            ProviderBottomSheet(
                providers = state.suiteProviders,
                selectedPlan = sheetTarget,
                maxVisible = 4,
                onProviderPicked = { provider ->
                    viewModel.dispatch(PayCraftPaywallAction.CheckoutWithProvider(sheetTarget, provider))
                },
                onDismiss = { viewModel.dispatch(PayCraftPaywallAction.DismissProviderSheet) },
            )
        }

        // Restore-purchases modal sheet — triggered by the legal-footer RESTORE
        // link (via PayCraftPaywallAction.OpenRestoreSheet) or by the host app opening
        // the sheet directly. OAuth handlers stay null at the SDK layer — consumer apps
        // wire them via PayCraftPaywallSheet/PayCraftPaywall overloads.
        PayCraftRestore(
            visible = state.isRestoreSheetVisible,
            onDismiss = { viewModel.dispatch(PayCraftPaywallAction.CloseRestoreSheet) },
        )
    }
}

/**
 * FullScreen render path — Scaffold + close-button top bar + optional test-mode chip
 * + [PaywallTemplate.render] (BrandedStackTemplate by default). Extracted so
 * [PayCraftPaywallComposable] can pick between FullScreen and Banner presentation
 * without a nested Scaffold in the Banner branch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PayCraftPaywallFullScreenSurface(
    state: PayCraftPaywallState,
    config: SuiteConfig?,
    snackbarHostState: SnackbarHostState,
    onAction: (PayCraftPaywallAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier
            .fillMaxSize()
            .testTag(PayCraftTestTags.PAYWALL_SCREEN),
        // Sheet callers set zero insets so the sheet handles insets itself.
        contentWindowInsets = WindowInsets(0.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = { /* Template renders its own hero title — top bar stays chromeless. */ },
                actions = {
                    IconButton(
                        onClick = { onAction(PayCraftPaywallAction.Dismiss) },
                        modifier = Modifier
                            .size(48.dp)
                            .testTag(PayCraftTestTags.DISMISS_BUTTON)
                            .semantics { contentDescription = "Close paywall" },
                    ) {
                        Icon(imageVector = Icons.Default.Close, contentDescription = null)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        val isTestMode = (PayCraft.config?.provider as? StripeProvider)?.isTestMode == true
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            if (isTestMode) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFF6F00))
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "⚙ TEST MODE — sandbox only, no real charges",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            // Plan cards come from the cloud /config fetch ([PayCraft.suiteConfigFlow]),
            // which resolves on a SEPARATE signal from [BillingState]. On cold start the
            // billing manager can resolve Loading → Free (no saved email) BEFORE /config
            // products arrive — so `config == null` while `state.billingState` is already
            // Free. Rendering the template's Free branch then would show BrandedStackFree
            // with an empty ProductList + disabled Continue button and NO shimmer.
            //
            // Treat "cloud config not yet resolved" (config == null) as products-still-
            // loading and render the SAME layout-matched [PaywallSkeleton] the
            // BillingState.Loading branch uses, until the config flow republishes non-null
            // (products load "in realtime" via the collectAsState above). Premium buyers
            // are exempt — their status renders without any product/config. A warm cache
            // (config already non-null) never forces the skeleton, so there is no flash;
            // once config resolves non-null the real content renders even if products is
            // genuinely empty (a real empty-state, not loading).
            val productsLoading = config == null && state.billingState !is BillingState.Premium
            if (productsLoading) {
                PaywallSkeleton(planCount = 3)
            } else {
                val template = PaywallTemplate.parse(config?.paywall?.template.orEmpty())
                val products: List<Product> = config?.products
                    ?.filter { it.active }
                    ?.map(ProductMapper::fromDto)
                    ?.sortedBy { it.displayOrder }
                    ?: emptyList()
                template.render(
                    state = state.billingState,
                    products = products,
                    onPickProduct = { product ->
                        onAction(PayCraftPaywallAction.SelectPlan(product.toBillingPlan(config)))
                    },
                    onRetry = { onAction(PayCraftPaywallAction.RefreshStatus) },
                )
            }
        }
    }
}

/**
 * Bridge a v2 [Product] to the v1 [BillingPlan] sealed-interface flow used by the
 * existing viewmodel. Handles the pre-init cold-cache path (config = null) by
 * falling through to the product's own base-price format.
 */
private fun Product.toBillingPlan(config: SuiteConfig?): BillingPlan {
    val dtoMatch = config?.products?.firstOrNull { it.id == this.id }
    val priced = dtoMatch?.resolvedPrice
    val priceLabel = when {
        priced != null -> Money(priced.amountCents, priced.currency).format()
        this is Product.Subscription -> basePrice.format()
        this is Product.Lifetime -> basePrice.format()
        this is Product.Trial -> "Free"
        else -> ""
    }
    val intervalLabel = when (this) {
        is Product.Subscription -> when (interval) {
            Product.Subscription.Interval.MONTH -> "month"
            Product.Subscription.Interval.QUARTER -> "quarter"
            Product.Subscription.Interval.SEMIANNUAL -> "6mo"
            Product.Subscription.Interval.YEAR -> "year"
        }
        is Product.Trial -> "trial"
        is Product.Lifetime -> "lifetime"
    }
    val trialDays = (this as? Product.Trial)?.durationDays
    return BillingPlan(
        id = id,
        name = displayName,
        price = priceLabel,
        interval = intervalLabel,
        rank = displayOrder,
        trialDays = trialDays,
    )
}
