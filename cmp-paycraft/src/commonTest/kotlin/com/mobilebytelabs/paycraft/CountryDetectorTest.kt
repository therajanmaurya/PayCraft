package com.mobilebytelabs.paycraft

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Locks the unified cross-platform country resolution + its provenance tags. Pins the precedence
 * `store storefront → server IP-geo → device/SIM → config locale → DEFAULT_COUNTRY` so a web/desktop
 * buyer (no storefront) still resolves to the authoritative server IP-geo instead of the device
 * locale, and every branch reports the correct [CountryProvenance] for downstream trust decisions.
 */
class CountryDetectorTest {

    @Test fun storefrontWinsOverEverything() {
        val d = CountryDetector.resolve(storefront = "IN", serverGeo = "GB", deviceSim = "US", configLocale = "fr")
        assertEquals("IN", d.country)
        assertEquals(CountryProvenance.AUTHORITATIVE_STORE, d.provenance)
    }

    @Test fun serverGeoBeatsDeviceAndLocale() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = "GB", deviceSim = "US", configLocale = "fr")
        assertEquals("GB", d.country)
        assertEquals(CountryProvenance.SERVER_IP_GEO, d.provenance)
    }

    @Test fun deviceUsedWhenNoStorefrontOrGeo() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = "US", configLocale = "fr")
        assertEquals("US", d.country)
        assertEquals(CountryProvenance.DEVICE_SIM, d.provenance)
    }

    @Test fun configLocaleFallback() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = null, configLocale = "FR")
        assertEquals("FR", d.country)
        assertEquals(CountryProvenance.LOCALE_FALLBACK, d.provenance)
    }

    @Test fun defaultCountryWhenAllAbsent() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = null, configLocale = null)
        assertEquals(CurrencyResolver.DEFAULT_COUNTRY, d.country)
        assertEquals(CountryProvenance.LOCALE_FALLBACK, d.provenance)
    }

    @Test fun blankSignalsAreSkipped() {
        // Blank storefront + blank geo must fall through to the device, not resolve to "".
        val d = CountryDetector.resolve(storefront = "  ", serverGeo = "", deviceSim = "IN", configLocale = "us")
        assertEquals("IN", d.country)
        assertEquals(CountryProvenance.DEVICE_SIM, d.provenance)
    }
}
