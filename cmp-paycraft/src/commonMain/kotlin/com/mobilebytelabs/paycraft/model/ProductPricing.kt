package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.billing.NativeDisplayPrice
import com.mobilebytelabs.paycraft.config.SuiteConfig

/** Money amount in minor units (cents/paise) + ISO 4217 currency code. */
data class Money(val amountMinor: Int, val currency: String) {
    fun format(): String {
        val major = amountMinor / 100
        val fraction = amountMinor % 100
        return when (currency.uppercase()) {
            "INR" -> "₹$major"
            "USD" -> "$" + formatMajorMinor(major, fraction)
            "EUR" -> "€" + formatMajorMinor(major, fraction)
            "GBP" -> "£" + formatMajorMinor(major, fraction)
            else -> "$currency " + formatMajorMinor(major, fraction)
        }
    }

    private fun formatMajorMinor(major: Int, fraction: Int): String {
        val absFraction = if (fraction < 0) -fraction else fraction
        val frac = absFraction.toString().padStart(2, '0')
        return "$major.$frac"
    }

    companion object {
        /**
         * Build a [Money] from a store price in micro-units (Play `priceAmountMicros` / StoreKit2
         * `price` × 1_000_000). Minor units (cents/paise) = micros / 10_000 (1 unit = 100 minor =
         * 1_000_000 micros). E.g. ₹799.00 → 799_000_000 micros → 79_900 paise → `Money(79900, "INR")`.
         */
        fun fromMicros(micros: Long, currency: String): Money = Money((micros / 10_000L).toInt(), currency)
    }
}

/**
 * Resolves the price the SDK should display for [this] product in the user's locale.
 *
 * Precedence: when a [nativePrice] is supplied (native billing lane — Android Play Billing /
 * iOS StoreKit2) it is the truth the store will actually charge and WINS over the cloud price —
 * this is what fixes an India buyer seeing the cloud GBP price instead of the store's ₹799.
 * Otherwise the cloud has already locale-resolved at /functions/v1/config render time via
 * [PriceDto]; this is the in-app accessor that falls back to the SDK-side base price.
 *
 * Returns null for [Product.Trial] — the trial card shows "Free for N days", not money.
 */
fun Product.displayPrice(config: SuiteConfig, nativePrice: NativeDisplayPrice? = null): Money? {
    if (this is Product.Trial) return null
    if (nativePrice != null) return Money.fromMicros(nativePrice.amountMicros, nativePrice.currencyCode)
    val dto = config.products.firstOrNull { it.id == this.id } ?: return fallbackPrice()
    val priced = dto.resolvedPrice
    if (priced != null) return Money(priced.amountCents, priced.currency)
    return fallbackPrice()
}

private fun Product.fallbackPrice(): Money? = when (this) {
    is Product.Subscription -> basePrice
    is Product.Lifetime -> basePrice
    is Product.Trial -> null
}
