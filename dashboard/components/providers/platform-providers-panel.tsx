"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Primary provider + fallback (migration 075 routing engine, simplified).
 *
 * One list of supported providers, each with connection status. The merchant marks ONE as PRIMARY;
 * every other connected provider becomes an automatic fallback (cheapest first) if the primary is
 * unavailable for a given customer. Saved as a single global routing rule whose ordered
 * `priority_methods` is `[primary, ...fallbacks]`.
 *
 * iOS/Android digital subscriptions always transact through the native store (App Store / Google
 * Play) per store policy — those are shown separately as automatic, not part of the primary/fallback
 * ordering (which governs web/desktop checkout).
 */

interface RegistryRow {
  method: string
  provider: string
  fee_percent: number | null
}
interface RoutingRule {
  id: string
  platform: string | null
  priority_methods: string[]
  country_code?: string | null
  currency?: string | null
  product_type?: string | null
}

const DISPLAY: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  direct_upi: "UPI Direct",
  google_play: "Google Play Billing",
  app_store: "App Store (StoreKit 2)",
}
const CONNECT_HREF: Record<string, string> = {
  stripe: "/providers/stripe",
  razorpay: "/providers/razorpay",
  cashfree: "/providers/cashfree",
  direct_upi: "/providers/upi",
  google_play: "/providers/google-play",
  app_store: "/providers/app-store",
}
const NATIVE: { key: string; on: string }[] = [
  { key: "google_play", on: "Android" },
  { key: "app_store", on: "iOS" },
]

export function PlatformProvidersPanel({
  registry,
  connectedProviders,
  initialRules,
}: {
  registry: RegistryRow[]
  connectedProviders: string[]
  initialRules: RoutingRule[]
}) {
  const connected = new Set(connectedProviders)

  // provider → { cheapest method, fee } from the fee-sorted registry (web providers only)
  const providerInfo = new Map<string, { method: string; fee: number }>()
  for (const r of registry) {
    if (!providerInfo.has(r.provider)) providerInfo.set(r.provider, { method: r.method, fee: r.fee_percent ?? 99 })
  }
  // all supported WEB providers, cheapest first
  const webProviders = [...providerInfo.keys()].sort((a, b) => providerInfo.get(a)!.fee - providerInfo.get(b)!.fee)

  // rules this panel manages = the "global" ones (no country/currency/product scoping)
  const managedRuleIds = initialRules
    .filter((r) => !r.country_code && !r.currency && !r.product_type)
    .map((r) => r.id)
  // current primary = first method of the managed rule that carries an ordered list
  const managedWithMethods = initialRules.find(
    (r) => !r.country_code && !r.currency && !r.product_type && (r.priority_methods?.length ?? 0) > 0,
  )
  const initialPrimary =
    (managedWithMethods && registry.find((r) => r.method === managedWithMethods.priority_methods[0])?.provider) || ""

  const [primary, setPrimary] = useState<string>(initialPrimary)
  const [ruleIds, setRuleIds] = useState<string[]>(managedRuleIds)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fee = (p: string) => {
    const f = providerInfo.get(p)?.fee
    return f != null && f < 99 ? `${f}%` : "—"
  }
  const pretty = (p: string) => DISPLAY[p] ?? p

  async function choosePrimary(provider: string) {
    if (!connected.has(provider) || saving) return
    setError(null)
    setSaving(true)
    setSaved(false)
    const prev = primary
    setPrimary(provider)
    try {
      // Replace the managed global rule: delete existing, then create one ordered rule.
      for (const id of ruleIds) {
        await fetch(`/api/routing-rules/${id}`, { method: "DELETE" }).catch(() => {})
      }
      // primary first, then the other CONNECTED web providers (cheapest first) as fallback
      const ordered = [provider, ...webProviders.filter((p) => p !== provider && connected.has(p))]
      const methods = ordered.map((p) => providerInfo.get(p)?.method).filter(Boolean) as string[]
      const res = await fetch("/api/routing-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "any", priority_methods: methods, country_code: null, currency: null, product_type: null, priority: 10 }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `save failed (${res.status})`)
      }
      const { id } = await res.json()
      setRuleIds(id ? [id] : [])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setPrimary(prev)
      setError(e?.message ?? "save failed")
    } finally {
      setSaving(false)
    }
  }

  // fallback rank among connected web providers (primary excluded)
  const fallbackOrder = webProviders.filter((p) => p !== primary && connected.has(p))

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Payment providers</h2>
          {saved && <span className="text-xs font-semibold text-emerald-600">✓ updated</span>}
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          Pick your <strong>primary</strong> provider for web &amp; desktop checkout. Every other
          connected provider becomes an automatic <strong>fallback</strong> (cheapest first) if the
          primary can't serve a customer. iOS &amp; Android digital subscriptions always use the
          native store per store policy.
        </p>

        {/* Primary + fallback list */}
        <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
          {webProviders.map((p) => {
            const isConnected = connected.has(p)
            const isPrimary = primary === p
            const fbIndex = fallbackOrder.indexOf(p)
            return (
              <button
                key={p}
                type="button"
                disabled={!isConnected || saving}
                onClick={() => choosePrimary(p)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed hover:bg-ink-50/60 disabled:hover:bg-transparent"
              >
                <span
                  className={
                    "w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 " +
                    (isPrimary ? "border-brand-500 bg-brand-500" : "border-ink-300")
                  }
                >
                  {isPrimary && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-sm font-semibold text-ink-900 w-40">{pretty(p)}</span>
                <span className="text-xs text-ink-500 w-16">{fee(p)}</span>
                <span className="flex-1" />
                {isConnected ? (
                  isPrimary ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-brand-700 bg-brand-50 border border-brand-200 rounded px-1.5 py-0.5">Primary</span>
                  ) : primary && fbIndex >= 0 ? (
                    <span className="text-[11px] text-ink-400">Fallback {fbIndex + 1}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
                    </span>
                  )
                ) : (
                  <Link
                    href={CONNECT_HREF[p] ?? "/providers"}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
                  >
                    Connect →
                  </Link>
                )}
              </button>
            )
          })}
        </div>
        {saving && <p className="text-xs text-ink-400 mt-2">saving…</p>}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        {/* Native in-app billing (automatic) */}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mt-6 mb-2">In-app billing (automatic)</h3>
        <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
          {NATIVE.map((n) => (
            <div key={n.key} className="flex items-center gap-3 px-4 py-3">
              <span className="text-sm font-semibold text-ink-900 w-40">{pretty(n.key)}</span>
              <span className="text-[11px] text-ink-400">Auto on {n.on}</span>
              <span className="flex-1" />
              {connected.has(n.key) ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
                </span>
              ) : (
                <Link href={CONNECT_HREF[n.key] ?? "/providers"} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700">
                  Connect →
                </Link>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-400 mt-3">
          Fees are the provider's domestic rate — lower routes cheaper. Cross-border adds each provider's FX markup.
          Digital subscriptions on iOS/Android always use the native store (Apple 3.1.1 / Google Play policy).
        </p>
      </CardBody>
    </Card>
  )
}
