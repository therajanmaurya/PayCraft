// Release-less A/B tests: the server resolves a device's arm exactly as the app SDK does (Experiment.kt#assign —
// the SAME vectors are pinned in ExperimentArmParityTest.kt), and applies what the arm changes to /config.
// Run: deno test --no-check supabase/functions/__tests__/experiment-arm.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { applyArm, armCoupon, assignArm } from "../_shared/experiment-arm.ts"

const arms = [{ key: "a", weight: 50 }, { key: "b", weight: 30 }, { key: "c", weight: 20 }]
const VECTORS: Record<string, string> = {
  "dev-0": "a", "dev-1": "a", "dev-2": "a", "ünïcödé-id": "a", "9f1c2e3a-0b7d-4c55-8e21-3a4b5c6d7e8f": "a",
  "dev-7": "b", "dev-9": "b", "dev-11": "b", "dev-3": "c", "dev-6": "c", "dev-8": "c",
}

Deno.test("assignArm matches the SDK's assignment (shared vectors)", () => {
  for (const [id, arm] of Object.entries(VECTORS)) assertEquals(assignArm("price-test", arms, id)?.key, arm, id)
  assertEquals(assignArm("", arms, "d"), null)
  assertEquals(assignArm("k", [{ key: "x", weight: 0 }], "d"), null)
})

Deno.test("armCoupon: an arm turns discounts off or swaps the coupon", () => {
  assertEquals(armCoupon("c25", null), "c25")
  assertEquals(armCoupon("c25", { key: "a", weight: 1, exit_offer: false }), null)
  assertEquals(armCoupon("c25", { key: "a", weight: 1, exit_offer_coupon_id: "c50" }), "c50")
})

const body = () => ({
  paywall: { template: "branded-stack", workflow: { tree: 1 } },
  exit_survey: {
    enabled: true,
    title: "Why?",
    reasons: [{ code: "too_expensive", action: "offer", offer: { percent_off: 25, duration: "once" } }, { code: "x", action: "none" }],
    exit_offer: { percent_off: 25, duration: "once" },
  },
})
const half = { percent_off: 50, duration: "repeating", duration_in_months: 3 }

Deno.test("applyArm: design and discount resolved into the config; no arm = untouched", () => {
  const b = body()
  assertEquals(applyArm(b, null), b)
  const d = applyArm(b, { key: "m", weight: 1, paywall_template: "minimal", exit_offer: half })
  assertEquals(d.paywall, { template: "minimal", workflow: null })
  assertEquals(d.exit_survey.exit_offer, half)
  assertEquals(d.exit_survey.reasons[0].offer, half)
  assertEquals(b.paywall.template, "branded-stack", "input not mutated")
})

Deno.test("applyArm: an arm with discounts off loses the exit offer and offer answers", () => {
  const off = applyArm(body(), { key: "o", weight: 1, exit_offer: false })
  assertEquals(off.exit_survey.exit_offer, undefined)
  assertEquals(off.exit_survey.reasons[0], { code: "too_expensive", action: "none" })
  assertEquals(off.paywall.workflow, { tree: 1 }, "design untouched")
})
