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

test("ok:true → synced (no reason needed)", () => {
  expect(classifyProvider({ ok: true })).toEqual({ status: "synced" })
})

test("skipped:true → skipped WITH a reason (never opaque)", () => {
  const out = classifyProvider({ skipped: true, reason: "Stripe is not connected" })
  expect(out.status).toBe("skipped")
  expect(out.reason).toBe("Stripe is not connected")
})

test("skipped with no reason still carries a fallback reason", () => {
  expect(classifyProvider({ skipped: true }).reason).toBeTruthy()
  expect(classifyProvider(undefined)).toMatchObject({ status: "skipped" })
  expect(classifyProvider(undefined).reason).toBeTruthy()
})

test("not-connected error → skipped, never failed, reason preserved", () => {
  const r = classifyProvider({ ok: false, error: "Razorpay is not connected for this tenant" })
  expect(r.status).toBe("skipped")
  expect(r.reason).toMatch(/not connected/)
  expect(classifyProvider({ error: "no stored Google Play service-account credential" }).status)
    .toBe("skipped")
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
