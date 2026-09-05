/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The two surfaces the resilience chain needs above the paywall template: a terminal
 * "config unavailable" state, and a staleness notice for data served from an expired cache.
 * Both replace situations that previously rendered an indefinite skeleton.
 */
package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.config.ConfigResult

/**
 * Terminal state: every resilience layer failed and there is nothing purchasable to show.
 *
 * The wording is chosen per reason, because "check your connection" is actively unhelpful when the
 * user's connection is fine and the fault is ours. Retry is offered only when the failure could
 * plausibly clear on its own — a decode error will not.
 */
@Composable
fun ConfigUnavailable(
    result: ConfigResult,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val (title, body) = when (result) {
        is ConfigResult.Failed -> when (result.reason) {
            ConfigResult.Failed.Reason.OFFLINE ->
                "You appear to be offline" to
                    "We could not load subscription options. Check your connection and try again."
            ConfigResult.Failed.Reason.HTTP_ERROR ->
                "Subscriptions are unavailable" to
                    "We could not load subscription options right now. This is on our side — please try again shortly."
            ConfigResult.Failed.Reason.DECODE_ERROR ->
                "Something went wrong" to
                    "We received an unexpected response while loading subscription options."
            ConfigResult.Failed.Reason.NOT_INITIALIZED ->
                "Subscriptions are unavailable" to
                    "Billing has not finished starting up."
            ConfigResult.Failed.Reason.UNKNOWN ->
                "Subscriptions are unavailable" to
                    "We could not load subscription options right now."
        }
        else ->
            "Subscriptions are unavailable" to
                "We could not load subscription options right now."
    }

    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            // Tagged per-reason so AC-28 can pair the offline and http-error goldens separately —
            // they differ only in wording, and the wording is the whole product decision.
            modifier = Modifier.testTag(
                if ((result as? ConfigResult.Failed)?.reason == ConfigResult.Failed.Reason.OFFLINE) {
                    PayCraftTestTags.OFFLINE_MESSAGE
                } else {
                    PayCraftTestTags.CONFIG_FAILED_MESSAGE
                },
            ),
        )
        if (result.isRetryable) {
            Button(
                onClick = onRetry,
                modifier = Modifier.testTag(PayCraftTestTags.CONFIG_FAILED_RETRY),
            ) { Text("Try again") }
        }
    }
}

/**
 * Shown above the paywall when the rendered prices came from an EXPIRED cache.
 *
 * Non-blocking on purpose: the prices are probably still right, and hiding a usable paywall behind
 * a warning would trade one bad outcome for another. The user is told, and can refresh.
 */
@Composable
fun StaleConfigNotice(
    ageSeconds: Long,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Showing saved pricing from ${humanizeAge(ageSeconds)}. Prices may have changed.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f).testTag(PayCraftTestTags.STALE_MESSAGE),
            )
            Text(
                text = "Refresh",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable(onClick = onRetry).testTag(PayCraftTestTags.STALE_REFRESH),
            )
        }
    }
}

/** Rounded, human-scale age. Precision here is noise — "3 days ago" is the whole message. */
internal fun humanizeAge(seconds: Long): String = when {
    seconds < 60 -> "moments ago"
    seconds < 3_600 -> "${seconds / 60} min ago"
    seconds < 86_400 -> "${seconds / 3_600} h ago"
    seconds < 172_800 -> "yesterday"
    else -> "${seconds / 86_400} days ago"
}
