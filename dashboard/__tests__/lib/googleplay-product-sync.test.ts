/**
 * Unit tests for `lib/googleplay-product-sync.ts`.
 *
 * Regression focus (2026-07-24 production incident): a tenant whose pricing
 * matrix carried two prices that both resolve to the SAME Play region (the
 * currency→region map is many-to-one — every euro-zone price → "DE") caused
 * `subscriptions.create` to fail with 400 "Region code DE is duplicated."
 * The create body's basePlans[].regionalConfigs MUST carry each regionCode at
 * most once. First price for a region wins, deterministically.
 *
 * `playAccessToken` is mocked (no real JWT grant); global fetch is mocked and
 * the create-call body is inspected directly from the mock call history.
 */

jest.mock("@/lib/store-jwt", () => ({
  playAccessToken: jest.fn(async () => "fake-play-token"),
}))

import { syncProductToGooglePlay } from "@/lib/googleplay-product-sync"

// playAccessToken is mocked, so the private_key is only JSON-parsed, never used
// to sign — a plain placeholder keeps the shape without tripping secret scanners.
const SA_JSON = JSON.stringify({
  client_email: "sa@example.iam.gserviceaccount.com",
  private_key: "test-placeholder-signing-key-mocked",
  token_uri: "https://oauth2.googleapis.com/token",
})

/** GET probe → 404 (absent), POST create → 200. Returns the fetch mock. */
function mockCreatePath(opts: { activateOk?: boolean } = {}) {
  const activateOk = opts.activateOk ?? true
  const fetchMock = jest
    .fn()
    // 1) GET subscriptions.get → 404 (not found → create branch)
    .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" })
    // 2) POST subscriptions.create → 200 ok
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" })
    // 3) POST basePlans:activate → ok (or 400 app-not-published)
    .mockResolvedValueOnce(
      activateOk
        ? { ok: true, status: 200, text: async () => "{}" }
        : {
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({ error: { code: 400, message: "The app is not published.", status: "FAILED_PRECONDITION" } }),
          },
    )
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

/** Pull the JSON body of the POST create call (the 2nd fetch invocation). */
function createBodyFrom(fetchMock: jest.Mock): any {
  const [, init] = fetchMock.mock.calls[1]
  return JSON.parse(init.body as string)
}

beforeEach(() => jest.clearAllMocks())

test("collapses duplicate-region prices to a single regionalConfig (DE-duplicate regression)", async () => {
  const fetchMock = mockCreatePath()

  await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-1",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [
      { currency: "USD", amountCents: 999 },
      { currency: "EUR", amountCents: 899 }, // → DE
      { currency: "EUR", amountCents: 950 }, // → DE again (must be dropped)
    ],
  )

  const body = createBodyFrom(fetchMock)
  const regions: string[] = body.basePlans[0].regionalConfigs.map(
    (c: any) => c.regionCode,
  )
  // DE appears exactly once; first EUR price (899) wins.
  expect(regions).toEqual(["US", "DE"])
  const de = body.basePlans[0].regionalConfigs.find((c: any) => c.regionCode === "DE")
  expect(de.price.units).toBe("8")
  expect(de.price.nanos).toBe(990000000) // 99 cents → 0.99 → 990,000,000 nanos
})

test("sanitizes hyphenated SKUs to a Play-legal product id (malformed-id regression)", async () => {
  const fetchMock = mockCreatePath()

  await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-3",
    "pro-quarterly", // hyphen is illegal in a Play subscription id
    "Pro Quarterly",
    "quarter",
    [{ currency: "USD", amountCents: 2847 }],
  )

  // The create body's productId — and the productId query param on both the GET
  // probe and the POST create — must be hyphen-free (underscore-substituted).
  const body = createBodyFrom(fetchMock)
  expect(body.productId).toBe("pro_quarterly")
  expect(body.productId).not.toMatch(/-/)
  const getUrl = fetchMock.mock.calls[0][0] as string
  const postUrl = fetchMock.mock.calls[1][0] as string
  expect(getUrl).toContain("/subscriptions/pro_quarterly")
  expect(postUrl).toContain("productId=pro_quarterly")
  // Base-plan ids DO allow hyphens, so the derived base plan keeps its shape.
  expect(body.basePlans[0].basePlanId).toBe("pro-quarterly-autorenew")
})

test("treats IDR/COP as whole-unit (zero-decimal) so Play prices are not ÷100 (below-min regression)", async () => {
  const fetchMock = mockCreatePath()

  await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-idr",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [
      { currency: "IDR", amountCents: 89892 }, // ID → whole rupiah, NOT 898.92
      { currency: "USD", amountCents: 999 }, // 2-decimal → $9.99
    ],
  )

  const body = createBodyFrom(fetchMock)
  const cfgs: any[] = body.basePlans[0].regionalConfigs
  const idr = cfgs.find((c) => c.regionCode === "ID")
  // Rp 89,892 sent as whole units (>= Play's IDR 1,000 minimum), NOT Rp 898.92.
  expect(idr.price.currencyCode).toBe("IDR")
  expect(idr.price.units).toBe("89892")
  expect(idr.price.nanos).toBe(0)
  // Sanity: a genuine 2-decimal currency still splits into units + nanos.
  const usd = cfgs.find((c) => c.regionCode === "US")
  expect(usd.price.units).toBe("9")
  expect(usd.price.nanos).toBe(990000000)
})

test("keeps distinct regions and skips unmapped currencies", async () => {
  const fetchMock = mockCreatePath()

  await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-2",
    "pro-annual",
    "Pro Annual",
    "year",
    [
      { currency: "USD", amountCents: 9950 }, // → US
      { currency: "INR", amountCents: 799000 }, // → IN
      { currency: "XYZ", amountCents: 100 }, // unmapped → skipped
    ],
  )

  const body = createBodyFrom(fetchMock)
  const regions: string[] = body.basePlans[0].regionalConfigs.map(
    (c: any) => c.regionCode,
  )
  expect(regions).toEqual(["US", "IN"])
})

test("activates the base plan after create → result.activated = true", async () => {
  const fetchMock = mockCreatePath({ activateOk: true })

  const result = await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-act",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [{ currency: "USD", amountCents: 999 }],
  )

  // 3rd fetch is the activate POST to the correct :activate endpoint.
  const [activateUrl, activateInit] = fetchMock.mock.calls[2]
  expect(activateUrl).toContain("/subscriptions/pro_monthly/basePlans/pro-monthly-autorenew:activate")
  expect(activateInit.method).toBe("POST")
  expect(result.activated).toBe(true)
  expect(result.activationError).toBeUndefined()
})

/**
 * CREATE path + FREE_TRIAL offer provisioning. Six fetches:
 *   0 GET sub → 404 · 1 POST create sub · 2 POST base-plan:activate
 *   3 GET offer → 404 · 4 POST offer create · 5 POST offer:activate
 */
function mockCreatePathWithTrial(opts: { offerActivateOk?: boolean } = {}) {
  const offerActivateOk = opts.offerActivateOk ?? true
  const ok = { ok: true, status: 200, text: async () => "{}" }
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" }) // GET sub
    .mockResolvedValueOnce(ok) // create sub
    .mockResolvedValueOnce(ok) // activate base plan
    .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" }) // GET offer
    .mockResolvedValueOnce(ok) // create offer
    .mockResolvedValueOnce(
      offerActivateOk
        ? ok
        : {
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({ error: { code: 400, message: "The app is not published.", status: "FAILED_PRECONDITION" } }),
          },
    ) // activate offer
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

test("provisions a FREE_TRIAL offer on the base plan when trialDays > 0", async () => {
  const fetchMock = mockCreatePathWithTrial()

  const result = await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-trial",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [
      { currency: "USD", amountCents: 999 }, // US
      { currency: "INR", amountCents: 29900 }, // IN
    ],
    undefined,
    14,
  )

  // The offer create is the 5th fetch (index 4). Assert the compliant shape.
  const [offerUrl, offerInit] = fetchMock.mock.calls[4]
  expect(offerUrl).toContain("/subscriptions/pro_monthly/basePlans/pro-monthly-autorenew/offers")
  expect(offerUrl).toContain("offerId=pro-monthly-autorenew-freetrial")
  const offer = JSON.parse(offerInit.body as string)
  expect(offer.offerId).toBe("pro-monthly-autorenew-freetrial")
  // Single free-trial phase of the requested length, priced free in every base-plan region.
  expect(offer.phases).toHaveLength(1)
  expect(offer.phases[0].duration).toBe("P14D")
  expect(offer.phases[0].recurrenceCount).toBe(1)
  expect(offer.phases[0].regionalConfigs.map((c: any) => c.regionCode)).toEqual(["US", "IN"])
  expect(offer.phases[0].regionalConfigs.every((c: any) => c.free && Object.keys(c.free).length === 0)).toBe(true)
  // New-subscriber-only acquisition offer + offer-level availability + tag.
  expect(offer.targeting.acquisitionRule.scope.thisSubscription).toEqual({})
  expect(offer.regionalConfigs.map((c: any) => c.regionCode)).toEqual(["US", "IN"])
  expect(offer.regionalConfigs.every((c: any) => c.newSubscriberAvailability === true)).toBe(true)
  expect(offer.offerTags).toEqual([{ tag: "free-trial" }])
  // 6th fetch activates the offer.
  const [actUrl] = fetchMock.mock.calls[5]
  expect(actUrl).toContain("/offers/pro-monthly-autorenew-freetrial:activate")
  expect(result.freeTrialOfferId).toBe("pro-monthly-autorenew-freetrial")
  expect(result.trialOfferActivated).toBe(true)
})

test("no trial → no offer calls and freeTrialOfferId is null", async () => {
  const fetchMock = mockCreatePath() // only 3 responses (no offer path)

  const result = await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-notrial",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [{ currency: "USD", amountCents: 999 }],
    undefined,
    0, // no trial
  )

  expect(fetchMock).toHaveBeenCalledTimes(3) // get + create + activate only
  expect(result.freeTrialOfferId).toBeNull()
})

test("trial-offer activation is best-effort: app-not-published does NOT fail the sync", async () => {
  const fetchMock = mockCreatePathWithTrial({ offerActivateOk: false })

  const result = await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-trial2",
    "pro-annual",
    "Pro Annual",
    "year",
    [{ currency: "USD", amountCents: 9950 }],
    undefined,
    7,
  )

  expect(result.freeTrialOfferId).toBe("pro-annual-autorenew-freetrial")
  expect(result.trialOfferActivated).toBe(false)
  expect(result.trialOfferError).toMatch(/not activated/i)
  expect(fetchMock).toHaveBeenCalledTimes(6) // full path, no throw
})

test("activation is best-effort: an app-not-published 400 does NOT fail the sync", async () => {
  const fetchMock = mockCreatePath({ activateOk: false })

  const result = await syncProductToGooglePlay(
    { serviceAccountJson: SA_JSON, packageName: "com.example.app" },
    "prod-act2",
    "pro-annual",
    "Pro Annual",
    "year",
    [{ currency: "USD", amountCents: 9950 }],
  )

  // The subscription still synced (id returned), but activation is flagged.
  expect(result.playProductId).toBe("pro_annual")
  expect(result.created).toBe(true)
  expect(result.activated).toBe(false)
  expect(result.activationError).toMatch(/not activated/i)
  expect(result.activationError).toMatch(/not published/i)
  expect(fetchMock).toHaveBeenCalledTimes(3) // get + create + activate (no throw)
})
