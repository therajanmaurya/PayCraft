/**
 * Unit test for `lib/appstore-product-sync.ts`.
 *
 * Regression focus (2026-07-25 production incident): `subscriptions.create`
 * failed with 409 ENTITY_ERROR.RELATIONSHIP.UNKNOWN because the create body
 * keyed the group relationship as `subscriptionGroup`. App Store Connect keys
 * it `group` (linking a `subscriptionGroups` resource). This asserts the
 * create body uses `group` and NOT `subscriptionGroup`.
 *
 * appStoreConnectToken is mocked (no real ES256 signing); global fetch is
 * mocked and routed by URL, and the create-call body is inspected directly.
 */

jest.mock("@/lib/store-jwt", () => ({
  appStoreConnectToken: jest.fn(() => "fake-asc-token"),
}))

import { syncProductToAppStore } from "@/lib/appstore-product-sync"

const CREDS = { keyId: "2X9R4HXF34", issuerId: "57246542-96fe-1a63-...", bundleId: "com.sensei.social", privateKeyP8: "test-placeholder-p8-mocked" }

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function installFetch() {
  const fetchMock = jest.fn(async (url: unknown, init: any) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    if (u.includes("/v1/apps?filter[bundleId]")) return res({ data: [{ id: "APP1" }] })
    if (u.includes("/subscriptionGroups?limit=200")) return res({ data: [] }) // none → create
    if (u.includes("/v1/subscriptionGroups") && method === "POST") return res({ data: { id: "GROUP1" } })
    if (u.includes("/subscriptions?filter[productId]")) return res({ data: [] }) // not found
    if (u.endsWith("/v1/subscriptions") && method === "POST") return res({ data: { id: "SUB1" } })
    if (u.includes("/pricePoints")) return res({ data: [{ id: "PP1", attributes: { customerPrice: "9.99" } }] })
    if (u.includes("/v1/subscriptionPrices") && method === "POST") return res({ data: { id: "PRICE1" } })
    return res({ data: [] })
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

beforeEach(() => jest.clearAllMocks())

test("subscription create keys the group relationship as `group` (not `subscriptionGroup`)", async () => {
  const fetchMock = installFetch()

  const result = await syncProductToAppStore(
    CREDS,
    "prod-1",
    "pro-monthly",
    "Pro Monthly",
    "month",
    [{ currency: "USD", amountCents: 999 }],
  )

  // Find the POST to /v1/subscriptions and inspect its body.
  const createCall = fetchMock.mock.calls.find(
    ([u, init]) => String(u).endsWith("/v1/subscriptions") && (init as any)?.method === "POST",
  )
  expect(createCall).toBeDefined()
  const body = JSON.parse((createCall![1] as any).body as string)
  expect(body.data.relationships.group).toEqual({ data: { type: "subscriptionGroups", id: "GROUP1" } })
  expect(body.data.relationships.subscriptionGroup).toBeUndefined()
  expect(result.created).toBe(true)
  expect(result.subscriptionResourceId).toBe("SUB1")
})
