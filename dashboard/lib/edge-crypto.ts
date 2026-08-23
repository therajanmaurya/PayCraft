/**
 * Edge-native crypto helpers (Web Crypto API — `globalThis.crypto`).
 *
 * Replaces Node's `crypto` / `node:crypto` so the dashboard runs on the
 * Cloudflare edge runtime (Pages) as well as Node. Web Crypto is available in
 * BOTH runtimes (Node 20+ and workerd), so these are portable — no behavior
 * change on the existing deploy, and no `node:` build-time resolution errors.
 */

const enc = new TextEncoder()

/** Hex-encoded cryptographically-random bytes (replaces crypto.randomBytes(n).toString("hex")). */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let out = ""
  for (const b of buf) out += b.toString(16).padStart(2, "0")
  return out
}

/** HMAC-SHA256 → hex (replaces crypto.createHmac("sha256", key).update(msg).digest("hex")). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  const bytes = new Uint8Array(sig)
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

/**
 * Constant-time string comparison (replaces crypto.timingSafeEqual).
 * Both inputs are treated as UTF-8; unequal lengths return false but still
 * iterate to avoid trivially leaking length via early return timing.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  const len = Math.max(ba.length, bb.length)
  let diff = ba.length ^ bb.length
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/** base64url(no padding) of raw bytes or a UTF-8 string. */
export function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? enc.encode(input) : input
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
