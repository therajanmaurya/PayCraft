import { playAccessToken, type PlayServiceAccountJson } from "./store-jwt"
// SINGLE SOURCE OF TRUTH for minor-unit semantics: prices in tenant_pricing are
// generated/stored by pricing-template.ts using THIS set to decide whether an
// amount is whole-units (zero-decimal, e.g. IDR/COP/JPY/VND) or ×100 minor
// units. Any consumer that reads amount_cents back MUST use the same set, or it
// mis-scales the price — a divergent local copy (the old Stripe-style list here
// omitted IDR + COP) is exactly what sent Play "IDR 898.92" for a Rp 89,892
// price and got rejected as below the IDR minimum.
import { ZERO_DECIMAL_CURRENCIES } from "./pricing-template-data"

/**
 * Create / update a Google Play subscription (+ auto-renewing base plan) for a
 * PayCraft product via the Play Developer API v3 `monetization.subscriptions`
 * resource, using a TENANT'S OWN service-account credentials.
 *
 * Endpoints (androidpublisher v3):
 *   GET    /applications/{packageName}/subscriptions/{productId}        (probe)
 *   POST   /applications/{packageName}/subscriptions?productId={id}     (create)
 *   PATCH  /applications/{packageName}/subscriptions/{productId}        (update listing)
 * Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions
 *
 * Idempotent — mirrors stripe-product-sync.ts:
 *   - We GET the subscription by productId first. Present → PATCH the listing
 *     (title) only (Play base-plan pricing is immutable once active, exactly
 *     like Stripe Prices). Absent (404) → CREATE the subscription + one
 *     auto-renewing base plan with per-region prices.
 *   - The productId is a stable, deterministic function of the PayCraft SKU,
 *     so a re-run always targets the SAME Play subscription (no duplicates).
 */

const ANDROID_PUBLISHER_BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3"

// Play requires a regionsVersion for any pricing write. This is the published
// price-config version tag; "2022/02" is the long-stable baseline Google
// documents in the monetization examples.
const REGIONS_VERSION = "2022/02"

export interface GooglePlayCreds {
  /** Decrypted service-account JSON blob (the whole document, as a string). */
  serviceAccountJson: string
  packageName: string
}

export interface GooglePlayPriceInput {
  currency: string // ISO 4217, e.g. "USD", "INR"
  amountCents: number // minor units (whole units for zero-decimal currencies)
}

export interface GooglePlaySyncResult {
  /** The Play subscription product id written back to tenant_products.play_product_id. */
  playProductId: string
  basePlanId: string
  created: boolean
  /**
   * Whether the base plan is ACTIVE (purchasable) after this sync. A freshly
   * created base plan is DRAFT until activated, and Play only allows activation
   * once the app is published — so this can be false even on a successful sync.
   */
  activated: boolean
  /** Human-readable reason the base plan is not active (present iff !activated). */
  activationError?: string
  /**
   * The Play free-trial OFFER id created on the base plan when the product has a
   * trial configured (trial_enabled + trial_duration_days). null when no trial.
   * Without this offer the Play cart never grants the trial the paywall advertises
   * — the exact Subscriptions-policy mismatch that got reels-downloader rejected.
   */
  freeTrialOfferId?: string | null
  /** Whether the free-trial offer is ACTIVE (purchasable). Best-effort, like the base plan. */
  trialOfferActivated?: boolean
  /** Human-readable reason the trial offer is not active (present iff a trial was requested but not active). */
  trialOfferError?: string
}

// Minimal ISO-4217 currency → CLDR region map for the common PayCraft set.
// Unmapped currencies are skipped (logged) rather than guessed.
export const CURRENCY_REGION: Record<string, string> = {
  USD: "US", INR: "IN", GBP: "GB", EUR: "DE", JPY: "JP", CAD: "CA",
  AUD: "AU", SGD: "SG", BRL: "BR", MXN: "MX", ZAR: "ZA", AED: "AE",
  IDR: "ID", NGN: "NG", KRW: "KR",
}

/** PayCraft billing interval → ISO-8601 duration for a Play base plan. */
export function playBillingPeriod(interval: string | null | undefined): string {
  switch (interval) {
    case "month": return "P1M"
    case "quarter": return "P3M"
    case "semiannual": return "P6M"
    case "year": return "P1Y"
    default:
      throw new Error(`unsupported subscription interval for Play base plan: ${String(interval)}`)
  }
}

/**
 * Play SUBSCRIPTION product ids: lowercase letters, digits, underscore (_) and
 * period (.) only — must start with a letter/number, ≤ 40 chars. Crucially,
 * HYPHENS are NOT allowed here (unlike base-plan ids, which do allow them), so a
 * SKU like "pro-monthly" must become "pro_monthly" or Play rejects the create
 * with 400 "Subscription ID is malformed". Anything outside the allowed set
 * (including "-") maps to underscore.
 */
function sanitizePlayProductId(sku: string): string {
  let id = sku.toLowerCase().replace(/[^a-z0-9._]/g, "_").replace(/^[._]+|[._]+$/g, "")
  if (!id) id = "product"
  return id.slice(0, 40).replace(/[._]+$/g, "") || "product"
}

/** Base plan ids: lowercase, [a-z0-9-], ≤ 63 chars. */
export function basePlanIdFor(playProductId: string): string {
  return `${playProductId}-autorenew`.replace(/[^a-z0-9-]/g, "-").slice(0, 63)
}

/** ISO minor units → Play Money { currencyCode, units, nanos }. */
export function toPlayMoney(currency: string, amountCents: number) {
  const ccy = currency.toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(ccy)) {
    return { currencyCode: ccy, units: String(Math.round(amountCents)), nanos: 0 }
  }
  const units = Math.floor(amountCents / 100)
  const nanos = (amountCents % 100) * 10_000_000 // 1 cent = 0.01 = 10,000,000 nanos
  return { currencyCode: ccy, units: String(units), nanos }
}

export async function playFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${ANDROID_PUBLISHER_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

/** Pull Google's `error.message` out of an API error body, else a short slice. */
export function shortPlayError(body: string): string {
  try {
    return (JSON.parse(body)?.error?.message as string) || body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

/**
 * Best-effort activation of a base plan so the subscription is actually
 * PURCHASABLE. A freshly created (or previously drafted) base plan sits in DRAFT
 * and cannot be sold until activated. Play only permits activation once the app
 * is PUBLISHED (an APK/AAB exists on at least one track), so this is best-effort:
 * when the app isn't published yet Play rejects it, and we return the reason
 * rather than throwing — the subscription itself already synced, and a later
 * re-sync (after the APK lands) flips the plan ACTIVE. Idempotent: an
 * already-active base plan counts as success.
 */
async function activateBasePlan(
  token: string,
  pkg: string,
  productId: string,
  basePlanId: string,
): Promise<{ activated: boolean; error?: string }> {
  const res = await playFetch(
    token,
    `/applications/${pkg}/subscriptions/${encodeURIComponent(productId)}/basePlans/${encodeURIComponent(basePlanId)}:activate`,
    { method: "POST", body: JSON.stringify({ packageName: pkg, productId, basePlanId }) },
  )
  if (res.ok) return { activated: true }
  const body = await res.text()
  // Already ACTIVE → the goal state is already met; treat as success.
  if (/already active/i.test(body)) return { activated: true }
  console.warn(
    `[googleplay-product-sync] base plan ${basePlanId} not activated for ${productId} (${res.status}): ${body}`,
  )
  return {
    activated: false,
    error: `base plan not activated (${res.status}): ${shortPlayError(body)}`,
  }
}

/**
 * Resolve the DEDUPED region list for a price set, mirroring the base-plan
 * region collapse (currency→region is many-to-one; first price per region wins).
 * The free-trial offer MUST be priced in the SAME regions as the base plan, so
 * both the base-plan create and the offer create derive regions from here.
 */
export function resolveRegions(prices: GooglePlayPriceInput[]): string[] {
  const regions: string[] = []
  const seen = new Set<string>()
  for (const { currency } of prices) {
    const region = CURRENCY_REGION[currency.toUpperCase()]
    if (!region || seen.has(region)) continue
    seen.add(region)
    regions.push(region)
  }
  return regions
}

/** Free-trial offer id: lowercase [a-z0-9-], ≤ 63 chars, deterministic per base plan. */
function freeTrialOfferIdFor(basePlanId: string): string {
  return `${basePlanId}-freetrial`.replace(/[^a-z0-9-]/g, "-").slice(0, 63).replace(/-+$/g, "")
}

/**
 * Ensure a FREE_TRIAL offer exists (and is active) on the base plan so the Play
 * cart actually GRANTS the trial the paywall advertises. Idempotent: probes the
 * offer first; creates it only when absent (offer phases are immutable once live,
 * same as base-plan pricing). Best-effort activation, like [activateBasePlan] —
 * Play blocks offer activation until the app is published, so a DRAFT trial offer
 * is a warning, not a throw. Regions match the base plan's regions exactly.
 *
 * Schema per androidpublisher v3 monetization.subscriptions.basePlans.offers:
 *   phases[0] = { duration: P{days}D, recurrenceCount: 1, regionalConfigs:[{regionCode, free:{}}] }
 *   targeting.acquisitionRule.scope.thisSubscription = {}   (new-subscriber only)
 *   regionalConfigs[] = [{regionCode, newSubscriberAvailability:true}]
 */
async function ensureFreeTrialOffer(
  token: string,
  pkg: string,
  productId: string,
  basePlanId: string,
  trialDays: number,
  regions: string[],
): Promise<{ offerId: string; activated: boolean; error?: string }> {
  const offerId = freeTrialOfferIdFor(basePlanId)
  if (regions.length === 0) {
    return { offerId, activated: false, error: "no priced regions to attach the free-trial offer to" }
  }

  const offersBase =
    `/applications/${pkg}/subscriptions/${encodeURIComponent(productId)}` +
    `/basePlans/${encodeURIComponent(basePlanId)}/offers`

  // Probe — does the offer already exist? (idempotent re-sync)
  const getRes = await playFetch(token, `${offersBase}/${encodeURIComponent(offerId)}`)
  let exists = getRes.ok
  if (!getRes.ok && getRes.status !== 404) {
    return {
      offerId,
      activated: false,
      error: `offers.get failed (${getRes.status}): ${shortPlayError(await getRes.text())}`,
    }
  }

  if (!exists) {
    const offerBody = {
      packageName: pkg,
      productId,
      basePlanId,
      offerId,
      phases: [
        {
          duration: `P${trialDays}D`,
          recurrenceCount: 1,
          regionalConfigs: regions.map((regionCode) => ({ regionCode, free: {} })),
        },
      ],
      // New-subscriber-only free trial (Play's standard acquisition offer).
      targeting: { acquisitionRule: { scope: { thisSubscription: {} } } },
      regionalConfigs: regions.map((regionCode) => ({ regionCode, newSubscriberAvailability: true })),
      offerTags: [{ tag: "free-trial" }],
    }
    const createRes = await playFetch(
      token,
      `${offersBase}?offerId=${encodeURIComponent(offerId)}&regionsVersion.version=${REGIONS_VERSION}`,
      { method: "POST", body: JSON.stringify(offerBody) },
    )
    if (!createRes.ok) {
      return {
        offerId,
        activated: false,
        error: `offers.create failed (${createRes.status}): ${shortPlayError(await createRes.text())}`,
      }
    }
    exists = true
  }

  // Activate (best-effort) so the trial is actually purchasable. Blocked until the
  // app is published → surface the reason rather than throwing.
  const actRes = await playFetch(
    token,
    `${offersBase}/${encodeURIComponent(offerId)}:activate`,
    { method: "POST", body: JSON.stringify({ packageName: pkg, productId, basePlanId, offerId }) },
  )
  if (actRes.ok) return { offerId, activated: true }
  const actBody = await actRes.text()
  if (/already active/i.test(actBody)) return { offerId, activated: true }
  return {
    offerId,
    activated: false,
    error: `free-trial offer not activated (${actRes.status}): ${shortPlayError(actBody)}`,
  }
}

export async function syncProductToGooglePlay(
  creds: GooglePlayCreds,
  paycraftProductId: string, // for logging correlation only
  sku: string,
  productName: string,
  interval: string | null,
  prices: GooglePlayPriceInput[],
  existingPlayProductId?: string,
  /** Free-trial length in days (from the subscription's trial_enabled + trial_duration_days). 0/undefined → no trial offer. */
  trialDays?: number | null,
): Promise<GooglePlaySyncResult> {
  const sa = JSON.parse(creds.serviceAccountJson) as PlayServiceAccountJson
  const token = await playAccessToken(sa)
  const pkg = creds.packageName
  if (!pkg) throw new Error("googleplay-product-sync: missing package_name in tenant store config")

  const productId = existingPlayProductId || sanitizePlayProductId(sku)
  const basePlanId = basePlanIdFor(productId)
  const regions = resolveRegions(prices)
  const wantsTrial = typeof trialDays === "number" && trialDays > 0

  // After the base plan is ensured (created OR already-present) provision the
  // FREE_TRIAL offer so the Play cart actually grants the trial. Runs in BOTH
  // branches so re-syncing an existing subscription can add a newly-configured
  // trial. No-trial products get an explicit null so the caller can detect it.
  const withTrial = async (base: GooglePlaySyncResult): Promise<GooglePlaySyncResult> => {
    if (!wantsTrial) return { ...base, freeTrialOfferId: null }
    const t = await ensureFreeTrialOffer(token, pkg, productId, basePlanId, trialDays as number, regions)
    return {
      ...base,
      freeTrialOfferId: t.offerId,
      trialOfferActivated: t.activated,
      trialOfferError: t.error,
    }
  }

  // 1. Probe — does this subscription already exist on Play?
  const getRes = await playFetch(
    token,
    `/applications/${pkg}/subscriptions/${encodeURIComponent(productId)}`,
  )

  if (getRes.ok) {
    // Present → refresh the listing title only. Base-plan pricing on Play is
    // immutable once active (same constraint as Stripe Prices), so we do not
    // rewrite prices here.
    const patchBody = {
      packageName: pkg,
      productId,
      listings: [{ languageCode: "en-US", title: productName.slice(0, 55) }],
    }
    const patchRes = await playFetch(
      token,
      `/applications/${pkg}/subscriptions/${encodeURIComponent(productId)}?updateMask=listings&regionsVersion.version=${REGIONS_VERSION}`,
      { method: "PATCH", body: JSON.stringify(patchBody) },
    )
    if (!patchRes.ok) {
      console.error(
        `[googleplay-product-sync] listing patch failed for ${productId} (${patchRes.status}): ${await patchRes.text()}`,
      )
    }
    // Re-sync of an existing subscription: attempt to activate the base plan
    // (a no-op if already active) — this is how a DRAFT plan goes live once the
    // tenant has finally published the app on Play.
    const act = await activateBasePlan(token, pkg, productId, basePlanId)
    return withTrial({
      playProductId: productId,
      basePlanId,
      created: false,
      activated: act.activated,
      activationError: act.error,
    })
  }

  if (getRes.status !== 404) {
    throw new Error(
      `[googleplay-product-sync] subscriptions.get(${productId}) failed (${getRes.status}): ${await getRes.text()}`,
    )
  }

  // 2. Not found → CREATE subscription + one auto-renewing base plan.
  //
  // Play's base-plan pricing is keyed by REGION, not currency, and the API
  // rejects the whole create with 400 "Region code X is duplicated." if the
  // same regionCode appears twice. Our currency→region map is many-to-one
  // (e.g. every euro-zone price resolves to DE), so a tenant pricing matrix
  // that carries two prices landing on the same region MUST be collapsed to a
  // single regionalConfig — first price for a region wins, deterministically.
  const regionalConfigs: Array<Record<string, unknown>> = []
  const seenRegions = new Set<string>()
  for (const { currency, amountCents } of prices) {
    const region = CURRENCY_REGION[currency.toUpperCase()]
    if (!region) {
      console.warn(
        `[googleplay-product-sync] no region mapping for ${currency}; skipping that price for ${productId}`,
      )
      continue
    }
    if (seenRegions.has(region)) {
      console.warn(
        `[googleplay-product-sync] region ${region} already priced (from an earlier currency); skipping duplicate ${currency} price for ${productId}`,
      )
      continue
    }
    seenRegions.add(region)
    regionalConfigs.push({
      regionCode: region,
      newSubscriberAvailability: true,
      price: toPlayMoney(currency, amountCents),
    })
  }

  const createBody = {
    packageName: pkg,
    productId,
    listings: [{ languageCode: "en-US", title: productName.slice(0, 55) }],
    basePlans: [
      {
        basePlanId,
        // Auto-renewing base plan of the requested cadence.
        autoRenewingBasePlanType: {
          billingPeriodDuration: playBillingPeriod(interval),
        },
        regionalConfigs,
      },
    ],
  }

  const createRes = await playFetch(
    token,
    `/applications/${pkg}/subscriptions?productId=${encodeURIComponent(productId)}&regionsVersion.version=${REGIONS_VERSION}`,
    { method: "POST", body: JSON.stringify(createBody) },
  )
  if (!createRes.ok) {
    throw new Error(
      `[googleplay-product-sync] subscriptions.create(${productId}) failed (${createRes.status}): ${await createRes.text()}`,
    )
  }

  // Created as DRAFT → activate so it's immediately purchasable. Best-effort:
  // blocked until the app is published, in which case a later re-sync activates.
  const act = await activateBasePlan(token, pkg, productId, basePlanId)
  return withTrial({
    playProductId: productId,
    basePlanId,
    created: true,
    activated: act.activated,
    activationError: act.error,
  })
}
