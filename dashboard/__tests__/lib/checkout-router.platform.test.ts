/**
 * Unit test for the per-platform routing dimension (migration 075 / AC7).
 *
 * The checkout router matches a routing rule to a caller platform via `platformMatches`: a rule
 * fires when it targets that exact platform OR is the "any"/null wildcard, and a platform-specific
 * rule never fires on a different platform. This locks that a "desktop → Stripe" rule selects on
 * desktop and is ignored on iOS.
 */

import { platformMatches } from "@/lib/checkout-router"

describe("platformMatches — per-platform routing (migration 075)", () => {
  it("a desktop-specific rule matches on desktop", () => {
    expect(platformMatches("desktop", "desktop")).toBe(true)
  })

  it("a desktop-specific rule is IGNORED on iOS", () => {
    expect(platformMatches("desktop", "ios")).toBe(false)
  })

  it('"any" rules match every platform', () => {
    expect(platformMatches("any", "ios")).toBe(true)
    expect(platformMatches("any", "android")).toBe(true)
    expect(platformMatches("any", null)).toBe(true)
  })

  it("null/undefined rule platform is treated as the wildcard", () => {
    expect(platformMatches(null, "web")).toBe(true)
    expect(platformMatches(undefined, "web")).toBe(true)
  })

  it("a platform-specific rule does not fire when the caller platform is unknown", () => {
    expect(platformMatches("android", null)).toBe(false)
  })

  it("desktop → Stripe end-to-end: selected on desktop, skipped on ios", () => {
    const rule = { platform: "desktop", priority_methods: ["stripe_card"] }
    expect(platformMatches(rule.platform, "desktop") ? rule.priority_methods[0] : null).toBe("stripe_card")
    expect(platformMatches(rule.platform, "ios") ? rule.priority_methods[0] : null).toBeNull()
  })
})
