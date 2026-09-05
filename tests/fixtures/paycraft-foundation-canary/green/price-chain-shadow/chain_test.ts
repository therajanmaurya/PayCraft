// AC-12 / AC-15 / AC-17 — the two price-country chains, exercised directly.
//
// These run the SHIPPED resolver, not a copy of its rules. The Stage A invariant is the one worth
// stating plainly: for every input, `resolveServed` must return exactly what the pre-deploy code
// would have returned (locale, or the pre-existing override) — otherwise "shadow mode" has already
// moved a price and D11's staging is theatre.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  diverges,
  resolveServed,
  resolveShadow,
  type PriceInputs,
} from "../../../../../supabase/functions/_shared/pricing-shadow.ts";

const base: PriceInputs = {
  overrideCountry: null,
  sdkCountry: null,
  sdkProvenance: null,
  geoCountry: null,
  localeCountry: "US",
  platform: "unknown",
};

Deno.test("AC-15 web: geo beats browser language — the live revenue bug", () => {
  // A US buyer whose browser prefers French. Today this is billed in EUR.
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "FR", geoCountry: "US" };
  assertEquals(resolveServed(i), { country: "FR", provenance: "locale" });   // what ships today
  assertEquals(resolveShadow(i), { country: "US", provenance: "server_geo" }); // what should ship
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), true);
});

Deno.test("AC-15 web NEVER falls to locale while geo is present", () => {
  for (const loc of ["FR", "DE", "JP", "IN"]) {
    const i: PriceInputs = { ...base, platform: "web", localeCountry: loc, geoCountry: "US" };
    assertEquals(resolveShadow(i).provenance, "server_geo");
  }
});

Deno.test("AC-15 desktop behaves as web — no storefront exists there either", () => {
  const i: PriceInputs = { ...base, platform: "desktop", localeCountry: "FR", geoCountry: "US" };
  assertEquals(resolveShadow(i), { country: "US", provenance: "server_geo" });
});

Deno.test("AC-12 native SDK signal outranks server geo", () => {
  // The SDK already resolved storefront-first and sent it via Accept-Language.
  const i: PriceInputs = {
    ...base, platform: "ios", sdkCountry: "IN", localeCountry: "IN", geoCountry: "US",
  };
  assertEquals(resolveShadow(i).country, "IN");
});

Deno.test("AC-12 an explicit SDK provenance is trusted over inference", () => {
  const i: PriceInputs = {
    ...base, platform: "ios", sdkCountry: "IN", sdkProvenance: "storefront",
    localeCountry: "IN", geoCountry: "US",
  };
  assertEquals(resolveShadow(i), { country: "IN", provenance: "storefront" });
});

Deno.test("an older SDK is reported as 'device', never as 'storefront'", () => {
  // The server cannot tell a storefront-derived country from a device-locale one when no
  // provenance header is sent. Claiming 'storefront' would put a false fact into the very log the
  // Stage B decision is made from.
  const i: PriceInputs = { ...base, platform: "android", sdkCountry: "GB", localeCountry: "GB" };
  assertEquals(resolveShadow(i).provenance, "device");
});

Deno.test("override wins in BOTH chains, so Stage A cannot change an overridden price", () => {
  const i: PriceInputs = {
    ...base, platform: "web", overrideCountry: "jp", localeCountry: "FR", geoCountry: "US",
  };
  assertEquals(resolveServed(i), { country: "JP", provenance: "override" });
  assertEquals(resolveShadow(i), { country: "JP", provenance: "override" });
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), false);
});

Deno.test("STAGE A INVARIANT — served is always locale-or-override, for every input", () => {
  const countries = ["US", "FR", "IN", "JP"];
  const platforms: PriceInputs["platform"][] = ["android", "ios", "web", "desktop", "unknown"];
  for (const platform of platforms) {
    for (const localeCountry of countries) {
      for (const geoCountry of [null, "US", "DE"]) {
        for (const sdkCountry of [null, "IN"]) {
          const i: PriceInputs = { ...base, platform, localeCountry, geoCountry, sdkCountry };
          assertEquals(resolveServed(i), { country: localeCountry, provenance: "locale" });
        }
      }
    }
  }
});

Deno.test("no geo and no SDK signal — both chains agree on locale, so nothing is logged", () => {
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "FR" };
  assertEquals(resolveShadow(i), { country: "FR", provenance: "locale" });
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), false);
});

Deno.test("country casing is normalised in both chains", () => {
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "fr", geoCountry: "us" };
  assertEquals(resolveServed(i).country, "FR");
  assertEquals(resolveShadow(i).country, "US");
});
