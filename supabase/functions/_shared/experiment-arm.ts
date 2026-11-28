// supabase/functions/_shared/experiment-arm.ts
//
// Release-less A/B tests: the SERVER resolves which arm of the running experiment a device is in, and what that
// arm changes, so a new kind of test needs no app release. Pure — `config` and `winback` load the rows.
//
// The arm is the SAME one the app SDK picks (`Experiment.kt#assign`): FNV-1a of `key:deviceId` into the weights.
// So events the app tags with its variant, the config the server resolves for it, and the win-back discount the
// server grants all agree — including on app versions that only ever sent their device id (winback's `deviceRef`).

export type ArmRow = {
  key: string
  weight: number
  offering_id?: string
  default_sku?: string | null
  /** false = no win-back discount for this arm; an object (as `/config` serves it) = this arm's discount. */
  exit_offer?: false | { percent_off: number; duration: string; duration_in_months?: number } | boolean | null
  exit_offer_coupon_id?: string | null
  paywall_template?: string | null
}

/** The arm [unitId] is in — byte-for-byte the SDK's assignment. Null when nothing is assignable. */
export function assignArm<T extends ArmRow>(key: string, variants: readonly T[], unitId: string): T | null {
  const arms = variants.filter((v) => v && v.weight > 0 && typeof v.key === "string" && v.key.trim() !== "")
  const total = arms.reduce((n, v) => n + v.weight, 0)
  if (!key.trim() || total <= 0) return null
  let h = 0x811c9dc5
  const s = `${key}:${unitId}`
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  let bucket = (h >>> 0) % total
  for (const arm of arms) {
    if (bucket < arm.weight) return arm
    bucket -= arm.weight
  }
  return arms[arms.length - 1]
}

/** The coupon a win-back offer uses for this buyer: none when their arm turned discounts off, else the arm's own. */
export function armCoupon(defaultCoupon: string | null | undefined, arm: ArmRow | null): string | null {
  if (arm?.exit_offer === false) return null
  return arm?.exit_offer_coupon_id || defaultCoupon || null
}

type Offer = { percent_off: number; duration: string; duration_in_months?: number }
type Survey = { enabled: boolean; reasons?: Array<{ action: string; offer?: Offer }>; exit_offer?: Offer; [k: string]: unknown }

/**
 * `/config` as [arm] sees it: its design (the template's seed — the published tree would otherwise win) and its
 * win-back discount, in the exit offer and in every survey answer that gives one. Untouched when the arm changes
 * neither; never mutates [body].
 */
export function applyArm<B extends { paywall?: Record<string, unknown>; exit_survey?: Survey }>(body: B, arm: ArmRow | null): B {
  if (!arm) return body
  const out: B = { ...body }
  if (arm.paywall_template && out.paywall) {
    out.paywall = { ...out.paywall, template: arm.paywall_template, workflow: null }
  }
  const choice = arm.exit_offer
  const survey = out.exit_survey
  if (survey && choice === false) {
    const { exit_offer: _drop, ...rest } = survey
    const reasons = (rest.reasons ?? []).map((r) =>
      r.action === "offer" ? (({ offer: _o, ...x }) => ({ ...x, action: "none" }))(r) : r
    )
    out.exit_survey = { ...rest, reasons, enabled: rest.enabled && reasons.length > 0 } as Survey
  } else if (survey && choice && typeof choice === "object") {
    const reasons = (survey.reasons ?? []).map((r) => (r.action === "offer" ? { ...r, offer: choice } : r))
    out.exit_survey = { ...survey, enabled: true, reasons, exit_offer: choice }
  }
  return out
}
