/**
 * Unit tests for `lib/razorpay-subscription-initiator.ts` — free-trial handling.
 *
 * Razorpay has no `trial_period_days`; a free trial is realized by scheduling the
 * subscription's FIRST charge in the future via `start_at` (the created_at..start_at
 * window is the trial, and the webhook flips status to `trialing`). These tests
 * assert the initiator sets `start_at = now + trialDays*86400` when a trial is
 * requested, and omits it otherwise.
 *
 * getConnectedRazorpayClient is mocked; the subscriptions.create payload is
 * captured directly.
 */

const subscriptionsCreate = jest.fn(async () => ({
  id: "sub_test123",
  short_url: "https://rzp.io/i/abc",
  status: "created",
}))

jest.mock("@/lib/razorpay-client", () => ({
  getConnectedRazorpayClient: jest.fn(async () => ({
    subscriptions: { create: subscriptionsCreate },
  })),
}))

import { createUpiAutopaySubscription } from "@/lib/razorpay-subscription-initiator"

const BASE = {
  tenantId: "tenant-1",
  planId: "plan_abc",
  customerEmail: "buyer@example.com",
  productSku: "Pro Monthly",
  productId: "prod-1",
  mode: "live" as const,
}

beforeEach(() => jest.clearAllMocks())

test("sets start_at ≈ now + trialDays for a subscription with a trial", async () => {
  const before = Math.floor(Date.now() / 1000)
  await createUpiAutopaySubscription({ ...BASE, trialDurationDays: 14 })
  const after = Math.floor(Date.now() / 1000)

  const payload = subscriptionsCreate.mock.calls[0][0] as any
  expect(payload.start_at).toBeGreaterThanOrEqual(before + 14 * 86_400)
  expect(payload.start_at).toBeLessThanOrEqual(after + 14 * 86_400)
})

test("omits start_at when no trial (immediate first charge)", async () => {
  await createUpiAutopaySubscription({ ...BASE, trialDurationDays: 0 })
  const payload = subscriptionsCreate.mock.calls[0][0] as any
  expect(payload.start_at).toBeUndefined()
})

test("omits start_at when trialDurationDays is undefined", async () => {
  await createUpiAutopaySubscription({ ...BASE })
  const payload = subscriptionsCreate.mock.calls[0][0] as any
  expect(payload.start_at).toBeUndefined()
})
