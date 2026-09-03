package com.mobilebytelabs.paycraft.model

/** Supported OAuth identity providers for ownership verification (Gate 1). */
enum class OAuthProvider { GOOGLE, APPLE }

/** How ownership was verified before a device transfer is confirmed. */
enum class VerificationMethod { OAUTH, OTP }

data class SubscriptionStatus(
    val isPremium: Boolean = false,
    val plan: String? = null,
    val email: String? = null,
    val provider: String? = null,
    val expiresAt: String? = null,
    val willRenew: Boolean = true,
)

sealed interface BillingState {
    data object Loading : BillingState
    data object Free : BillingState

    /**
     * Active or trialing subscription.
     *
     * [trial] is non-null when the underlying subscription is currently in its
     * free-trial window (`status = 'trialing'` server-side, `trial_end > now()`).
     * Consumer UI may key on `trial != null` to show trial-specific affordances
     * ("Trial ends in N days") instead of standard premium messaging.
     */
    data class Premium(val status: SubscriptionStatus, val trial: TrialInfo? = null) : BillingState

    data class Error(val message: String) : BillingState

    /**
     * The store accepted the order but payment has not cleared yet — Play `PurchaseState.PENDING`
     * (cash, UPI mandate, or a family Ask-to-Buy awaiting approval) or StoreKit `.pending`
     * (Ask to Buy / SCA).
     *
     * This is NOT [Error] and NOT [Premium]. The buyer's money is in flight and the resolution can
     * take days; it arrives asynchronously on `NativeBillingClient.purchaseUpdates`. Rendering it
     * as an error — which the SDK did before this arm existed — tells a buyer their payment failed
     * while the store is still processing it, and is a common cause of duplicate purchases.
     *
     * @param productId the product awaiting payment, so the UI can name what is pending.
     */
    data class PaymentPending(val productId: String) : BillingState

    /**
     * Subscription exists but is bound to a different (active) device.
     *
     * Resolution priority:
     *  1. OAuth (Gate 1) — Google / Apple sign-in proves email ownership instantly.
     *     Used when the user's email can be linked to a Google or Apple account.
     *  2. OTP (Gate 2) — 6-digit code sent via Brevo. Used for custom-domain emails.
     *     Limited to [otpDailyLimit] per day; [otpAvailable] = false when exhausted.
     *  3. Manual (Gate 3) — [otpAvailable] = false. UI shows pre-filled "Contact Support"
     *     email button with all device + subscription info.
     *
     * After Gate 1 or Gate 2 succeeds, [BillingState.OwnershipVerified] is emitted.
     */
    data class DeviceConflict(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        /** False when daily OTP send limit is reached → show Manual gate. */
        val otpAvailable: Boolean,
        val otpDailyLimit: Int,
        val supportEmail: String,
    ) : BillingState

    /**
     * Ownership has been verified (via OAuth or OTP).
     * The UI MUST show a confirmation dialog before calling
     * [BillingManager.confirmDeviceTransfer] — the user must explicitly consent
     * to deactivating the existing device.
     */
    data class OwnershipVerified(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        val verifiedVia: VerificationMethod,
        val supportEmail: String,
    ) : BillingState
}
