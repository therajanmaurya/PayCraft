import { hmacSha256Hex, timingSafeEqualStr, base64url } from "./edge-crypto"

const SECRET = process.env.PAYCRAFT_OAUTH_STATE_SECRET ?? "dev-secret-for-local-only"

/** Signed, time-boxed OAuth `state` for the Stripe Connect round-trip. */
export async function makeState(tenantId: string): Promise<string> {
  const ts = Date.now().toString()
  const payload = `${tenantId}:${ts}`
  const sig = await hmacSha256Hex(SECRET, payload)
  return base64url(`${payload}:${sig}`)
}

export async function verifyState(
  state: string,
  maxAgeMs = 600_000,
): Promise<{ tenantId: string } | null> {
  try {
    let b64 = state.replace(/-/g, "+").replace(/_/g, "/")
    b64 += "=".repeat((4 - (b64.length % 4)) % 4)
    const decoded = atob(b64)
    const parts = decoded.split(":")
    if (parts.length !== 3) return null
    const [tenantId, ts, sig] = parts
    const expected = await hmacSha256Hex(SECRET, `${tenantId}:${ts}`)
    if (!timingSafeEqualStr(sig, expected)) return null
    if (Date.now() - parseInt(ts, 10) > maxAgeMs) return null
    return { tenantId }
  } catch {
    return null
  }
}
