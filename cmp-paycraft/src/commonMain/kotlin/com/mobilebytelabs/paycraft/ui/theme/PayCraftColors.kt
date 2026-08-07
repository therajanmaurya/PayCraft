package com.mobilebytelabs.paycraft.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.config.effectiveThemeOverride

/**
 * PayCraft semantic color tokens.
 *
 * Use [PayCraftTheme.colors] to access the active color scheme rather than
 * instantiating these directly.
 */
data class PayCraftColors(
    /** Primary brand accent — used for selected plan borders, primary buttons, icons. */
    val accent: Color,

    /** Content on top of [accent] — typically white for high contrast on the brand colour. */
    val onAccent: Color = Color.White,

    /** Background of selected plan cards and premium status card. */
    val accentContainer: Color,

    /** Content on top of [accentContainer]. */
    val onAccentContainer: Color,

    /** Active badge background (green "ACTIVE" pill). */
    val activeBadge: Color,

    /** Content on top of [activeBadge]. */
    val onActiveBadge: Color,

    /** "Popular" badge background. */
    val popularBadge: Color,

    /** Content on top of [popularBadge]. */
    val onPopularBadge: Color,

    /** Error / warning background for error banners. */
    val errorContainer: Color,

    /** Content on top of [errorContainer]. */
    val onErrorContainer: Color,

    /** Surface for plan cards, sheets, and modals. */
    val surface: Color,

    /** Content on top of [surface]. */
    val onSurface: Color,

    /** Secondary content on top of [surface] (subtitles, hints). */
    val onSurfaceVariant: Color,

    /** Outline color for unselected plan cards. */
    val outline: Color,

    /** Border color for dividers and separators. */
    val divider: Color,
) {
    companion object {
        /**
         * Material3-adaptive default — reads tonal roles from the host app's MaterialTheme.
         *
         * Call [PayCraftTheme.default] to get a live instance that resolves against
         * the current Composition's MaterialTheme automatically.
         */
        @Suppress("MagicNumber")
        val Defaults = PayCraftColors(
            accent = Color(0xFF6750A4),
            accentContainer = Color(0xFFEADDFF),
            onAccentContainer = Color(0xFF21005D),
            activeBadge = Color(0xFF4CAF50),
            onActiveBadge = Color.White,
            popularBadge = Color(0xFFFF9800),
            onPopularBadge = Color.White,
            errorContainer = Color(0xFFFFDAD6),
            onErrorContainer = Color(0xFF410002),
            surface = Color.White,
            onSurface = Color(0xFF1C1B1F),
            onSurfaceVariant = Color(0xFF49454F),
            outline = Color(0xFFCAC4D0),
            divider = Color(0xFFE6E0E9),
        )
    }
}

// ------------------------------------------------------------------
// Branded fallback palette — folded from the retired
// `presentation/MobileByteSenseiTheme.kt` per RULE-DESIGN-CONFORMANCE-001 D2.
// These are the base PayCraft brand palettes the deprecated
// Minimal/Premium/Dark templates render against; the unified
// PayCraftThemeProvider layers cloud `theme_jsonb`/`primary_color` overrides
// on top of them via [BrandedPalette].
// ------------------------------------------------------------------

/**
 * PayCraft brand palette in light mode. Consumed by the deprecated
 * [com.mobilebytelabs.paycraft.presentation.templates.MinimalTemplate] and
 * [com.mobilebytelabs.paycraft.presentation.templates.PremiumTemplate] as their
 * neutral background/foreground base.
 */
@Suppress("MagicNumber")
val PayCraftBrandColorsLight: ColorScheme = lightColorScheme(
    primary = Color(0xFF6B4FE3),
    secondary = Color(0xFFFFB400),
    background = Color(0xFFFAFAFA),
    surface = Color.White,
    error = Color(0xFFE53935),
)

/**
 * PayCraft brand palette in dark mode. Consumed by the deprecated
 * [com.mobilebytelabs.paycraft.presentation.templates.DarkTemplate] as its
 * near-black background base.
 */
@Suppress("MagicNumber")
val PayCraftBrandColorsDark: ColorScheme = darkColorScheme(
    primary = Color(0xFF9D7FFF),
    secondary = Color(0xFFFFD159),
    background = Color(0xFF121212),
    surface = Color(0xFF1E1E1E),
    error = Color(0xFFFF5252),
)

// ------------------------------------------------------------------
// BrandedPalette — the normalized cloud-theme override contract
// consumed by PayCraftThemeProvider(config = …).
// Folded from `presentation/MobileByteSenseiTheme.applyThemeOverride(...)`.
// ------------------------------------------------------------------

/**
 * Normalized cloud theme override for the unified [PayCraftThemeProvider].
 *
 * Fields are optional — a `null` entry inherits the host [ColorScheme] value
 * unchanged. When ANY field is non-null the palette layers on top of the host
 * MaterialTheme via [toColorScheme], giving PayCraft its config-wins fallback
 * behaviour (see AC-3 of the paycraft-clean-sdk-ui-theme-modes epic).
 *
 * Built by [SuiteConfig.themeOverride] / [PaywallDto.brandedPaletteOverride]
 * from the cloud's `paywall.theme_jsonb` + `paywall.primary_color` columns.
 */
data class BrandedPalette(
    val primary: Color? = null,
    val secondary: Color? = null,
    val background: Color? = null,
    val surface: Color? = null,
    val error: Color? = null,
) {
    /**
     * Layer this palette on top of [fallback] — every non-null field wins, every
     * null field inherits [fallback]. Called by [PayCraftThemeProvider] once at
     * composition entry to build the resolved MaterialTheme colorScheme.
     */
    fun toColorScheme(fallback: ColorScheme): ColorScheme = fallback.copy(
        primary = primary ?: fallback.primary,
        secondary = secondary ?: fallback.secondary,
        background = background ?: fallback.background,
        surface = surface ?: fallback.surface,
        error = error ?: fallback.error,
    )
}

/**
 * Multiplatform hex-color parser. Accepts `#RRGGBB`, `#AARRGGBB`, `RRGGBB`,
 * `AARRGGBB`. Falls back to [Color.Unspecified] on unparseable input — callers
 * default to the base scheme value.
 *
 * Folded from `presentation/MobileByteSenseiTheme.parseHexColor(...)` so the
 * cloud-hex → Compose Color mapping lives next to [BrandedPalette].
 */
@Suppress("MagicNumber")
internal fun parseHexColor(hex: String): Color {
    val trimmed = hex.trim().removePrefix("#")
    val normalized = when (trimmed.length) {
        6 -> "FF$trimmed"
        8 -> trimmed
        else -> return Color.Unspecified
    }
    val parsed = normalized.toLongOrNull(16) ?: return Color.Unspecified
    val alpha = ((parsed shr 24) and 0xFF).toInt()
    val red = ((parsed shr 16) and 0xFF).toInt()
    val green = ((parsed shr 8) and 0xFF).toInt()
    val blue = (parsed and 0xFF).toInt()
    return Color(red = red, green = green, blue = blue, alpha = alpha)
}

/**
 * Cloud theme override for this [PaywallDto], parsed from `theme_jsonb` +
 * `primary_color` via [effectiveThemeOverride] and mapped through
 * [parseHexColor]. Returns `null` when the tenant hasn't configured any brand
 * override — the unified [PayCraftThemeProvider] then falls through to the
 * host app's MaterialTheme (host-inherit, AC-2).
 */
val PaywallDto.brandedPaletteOverride: BrandedPalette?
    get() {
        val map = effectiveThemeOverride
        if (map.isEmpty()) return null
        val primary = map["primary"]?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
        val secondary = map["secondary"]?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
        val background = map["background"]?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
        val surface = map["surface"]?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
        val error = map["error"]?.let(::parseHexColor)?.takeIf { it != Color.Unspecified }
        if (primary == null && secondary == null && background == null && surface == null && error == null) {
            return null
        }
        return BrandedPalette(
            primary = primary,
            secondary = secondary,
            background = background,
            surface = surface,
            error = error,
        )
    }

/**
 * Normalized cloud theme override for this [SuiteConfig]. Delegates to the
 * paywall-scoped [PaywallDto.brandedPaletteOverride] — the sole normalized
 * accessor the unified [PayCraftThemeProvider] consumes.
 */
val SuiteConfig.themeOverride: BrandedPalette?
    get() = paywall.brandedPaletteOverride
