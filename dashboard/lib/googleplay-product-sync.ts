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
}

// Minimal ISO-4217 currency → CLDR region map for the common PayCraft set.
// Unmapped currencies are skipped (logged) rather than guessed.
const CURRENCY_REGION: Record<string, string> = {
  USD: "US", INR: "IN", GBP: "GB", EUR: "DE", JPY: "JP", CAD: "CA",
  AUD: "AU", SGD: "SG", BRL: "BR", MXN: "MX", ZAR: "ZA", AED: "AE",
  IDR: "ID", NGN: "NG", KRW: "KR",
}

/** PayCraft billing interval → ISO-8601 duration for a Play base plan. */
function playBillingPeriod(interval: string | null | undefined): string {
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
function basePlanIdFor(playProductId: string): string {
  return `${playProductId}-autorenew`.replace(/[^a-z0-9-]/g, "-").slice(0, 63)
}

/** ISO minor units → Play Money { currencyCode, units, nanos }. */
function toPlayMoney(currency: string, amountCents: number) {
  const ccy = currency.toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(ccy)) {
    return { currencyCode: ccy, units: String(Math.round(amountCents)), nanos: 0 }
  }
  const units = Math.floor(amountCents / 100)
  const nanos = (amountCents % 100) * 10_000_000 // 1 cent = 0.01 = 10,000,000 nanos
  return { currencyCode: ccy, units: String(units), nanos }
}

async function playFetch(
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

export async function syncProductToGooglePlay(
  creds: GooglePlayCreds,
  paycraftProductId: string, // for logging correlation only
  sku: string,
  productName: string,
  interval: string | null,
  prices: GooglePlayPriceInput[],
  existingPlayProductId?: string,
): Promise<GooglePlaySyncResult> {
  const sa = JSON.parse(creds.serviceAccountJson) as PlayServiceAccountJson
  const token = await playAccessToken(sa)
  const pkg = creds.packageName
  if (!pkg) throw new Error("googleplay-product-sync: missing package_name in tenant store config")

  const productId = existingPlayProductId || sanitizePlayProductId(sku)
  const basePlanId = basePlanIdFor(productId)

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
    return { playProductId: productId, basePlanId, created: false }
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

  return { playProductId: productId, basePlanId, created: true }
}
