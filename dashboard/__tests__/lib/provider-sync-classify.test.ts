/**
 * Unit tests for `classifyProvider` — the normalizer that turns each provider
 * helper's return into a durable ProviderSyncEntry (migration 078 sync_state).
 *
 * Focus: every helper now returns STRUCTURED status ({ok,skipped,error} for
 * Stripe/Cashfree/Razorpay; {error,warning} for the native stores). This asserts
 * the classification is precise — an unconnected provider is `skipped` (never a
 * false "failed"), a real error is `failed` with its reason, a base-synced/
 * trial-DRAFT is `draft`, and success is `synced`.
 *
 * supabase-server is mocked away — importing stripe-route-helper pulls it, but
 * classifyProvider itself touches nothing external.
 */

jest.mock("@/lib/supabase-server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/stripe-client", () => ({ getConnectedStripeClient: jest.fn() }))
jest.mock("@/lib/razorpay-client", () => ({ getConnectedRazorpayClient: jest.fn() }))

import { classifyProvider } from "@/lib/stripe-route-helper"

test("ok:true → synced (Stripe/Cashfree/Razorpay success)", () => {
  expect(classifyProvider({ ok: true })).toEqual({ status: "synced" })
})

test("skipped:true → skipped (provider not connected / not applicable)", () => {
  expect(classifyProvider({ skipped: true })).toEqual({ status: "skipped" })
})

test("undefined → skipped (provider returned nothing)", () => {
  expect(classifyProvider(undefined)).toEqual({ status: "skipped" })
})

test("not-connected error → skipped, never failed", () => {
  expect(classifyProvider({ ok: false, error: "Razorpay is not connected for this tenant" }))
    .toEqual({ status: "skipped" })
  expect(classifyProvider({ error: "no stored Google Play service-account credential" }))
    .toEqual({ status: "skipped" })
})

test("real error → failed + reason", () => {
  const out = classifyProvider({
    ok: false,
    error: "Razorpay [400]: Currency is not supported",
  })
  expect(out.status).toBe("failed")
  expect(out.error).toMatch(/Currency is not supported/)
})

test("warning (base synced, trial offer DRAFT) → draft", () => {
  const out = classifyProvider({ warning: "base plan live but the 14-day free-trial offer is still DRAFT" })
  expect(out.status).toBe("draft")
  expect(out.warning).toMatch(/DRAFT/)
})

test("error wins over warning when both present", () => {
  expect(classifyProvider({ error: "hard fail", warning: "soft" }).status).toBe("failed")
})
