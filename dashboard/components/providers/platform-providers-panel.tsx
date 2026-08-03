"use client"

import { useState } from "react"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Platform → provider selector (migration 075 routing engine, surfaced as a first-class panel).
 *
 * Lets a merchant pick which payment provider each app platform uses, WITH each provider's fee shown
 * so they can route to the cheapest connection:
 *   - iOS / Android — digital subscriptions ALWAYS transact through the native store (App Store /
 *     Google Play) per Apple 3.1.1 / Google Play Payments policy (enforced by the SDK compliance lane,
 *     not routable). The dropdown sets the WEB-lane / physical-goods fallback provider.
 *   - Desktop / Web — no native store, so the merchant picks the PSP freely.
 *
 * Defaults: when a platform has no explicit rule, the dropdown shows the CHEAPEST connected provider
 * (the router's actual default), named + with its fee, so it's never ambiguous. Choosing a specific
 * provider writes/replaces a `platform=<p>` routing rule; choosing "Cheapest" removes it.
 */

interface RegistryRow {
  method: string
  provider: string
  display_name: string
  fee_percent: number | null
}
interface RoutingRule {
  id: string
  platform: string | null
  priority_methods: string[]
}

const PLATFORMS: { key: string; label: string; native?: string; hint: string }[] = [
  { key: "ios", label: "iOS", native: "App Store (StoreKit 2)", hint: "Digital subscriptions use the App Store automatically (Apple 3.1.1). Dropdown sets the web / physical-goods fallback." },
  { key: "android", label: "Android", native: "Google Play Billing", hint: "Digital subscriptions use Google Play automatically (Payments policy). Dropdown sets the web / physical-goods fallback." },
  { key: "desktop", label: "Desktop", hint: "No native store — pick the provider used for checkout on desktop." },
  { key: "web", label: "Web", hint: "No native store — pick the provider used for checkout on the web." },
]

function prettyProvider(p: string) {
  return p.charAt(0).toUpperCase() + p.slice(1).replace(/[-_]/g, " ")
}

export function PlatformProvidersPanel({
  registry,
  connectedProviders,
  initialRules,
}: {
  registry: RegistryRow[]
  connectedProviders: string[]
  initialRules: RoutingRule[]
}) {
  // provider → { cheapest method, its fee% }. Registry is fee-sorted, so the first row per provider
  // is its cheapest method.
  const providerInfo = new Map<string, { method: string; fee: number }>()
  for (const r of registry) {
    if (!providerInfo.has(r.provider)) providerInfo.set(r.provider, { method: r.method, fee: r.fee_percent ?? 99 })
  }
  // connected providers that have a routable web method, sorted CHEAPEST first
  const options = [...new Set(connectedProviders)]
    .filter((p) => providerInfo.has(p))
    .sort((a, b) => (providerInfo.get(a)!.fee) - (providerInfo.get(b)!.fee))
  const cheapest = options[0] ?? null

  // current explicit platform → provider, from the rules
  const initial: Record<string, string> = {}
  const ruleIdByPlatform = new Map<string, string>()
  for (const rule of initialRules) {
    if (!rule.platform || rule.platform === "any") continue
    ruleIdByPlatform.set(rule.platform, rule.id)
    const provider = registry.find((r) => r.method === rule.priority_methods?.[0])?.provider
    if (provider) initial[rule.platform] = provider
  }

  const [selection, setSelection] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const feeLabel = (p: string) => {
    const f = providerInfo.get(p)?.fee
    return f != null && f < 99 ? `${f}%` : "—"
  }

  async function save(platform: string, provider: string) {
    setError(null)
    setSaving(platform)
    setSelection((s) => ({ ...s, [platform]: provider }))
    try {
      const existingId = ruleIdByPlatform.get(platform)
      if (existingId) {
        await fetch(`/api/routing-rules/${existingId}`, { method: "DELETE" })
        ruleIdByPlatform.delete(platform)
      }
      if (provider) {
        const method = providerInfo.get(provider)?.method
        const res = await fetch("/api/routing-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform, priority_methods: method ? [method] : [], country_code: null, currency: null, product_type: null, priority: 50 }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error ?? `save failed (${res.status})`)
        }
        const { id } = await res.json()
        if (id) ruleIdByPlatform.set(platform, id)
      }
    } catch (e: any) {
      setError(`${platform}: ${e?.message ?? "save failed"}`)
    } finally {
      setSaving(null)
    }
  }

  const cheapestOptionLabel = cheapest
    ? `Cheapest: ${prettyProvider(cheapest)} · ${feeLabel(cheapest)}`
    : "Default (cheapest eligible)"

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Platform providers</h2>
          <Badge>fees shown</Badge>
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          Choose which provider each platform of your app uses — cheapest first, with each provider's
          fee shown so you can route to the connection that saves the most. iOS and Android digital
          subscriptions are handled by the native store automatically; Desktop and Web are yours to route.
        </p>

        <div className="space-y-2.5">
          {PLATFORMS.map((p) => {
            const selected = selection[p.key] ?? "" // "" = cheapest/default
            return (
              <div key={p.key} className="grid grid-cols-[110px_1fr] items-center gap-3 py-2 border-t border-ink-100 first:border-t-0">
                <span className="text-sm font-bold text-ink-900">{p.label}</span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.native && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-700 bg-ink-50 border border-ink-200 rounded-md px-2 py-1">
                        {p.native}
                        <Badge>auto</Badge>
                      </span>
                    )}
                    <select
                      value={selected}
                      disabled={saving === p.key || options.length === 0}
                      onChange={(e) => save(p.key, e.target.value)}
                      className="min-w-[220px] px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 disabled:opacity-60"
                      aria-label={`${p.label} provider`}
                    >
                      <option value="">{p.native ? `Web fallback — ${cheapestOptionLabel}` : cheapestOptionLabel}</option>
                      {options.map((prov) => (
                        <option key={prov} value={prov}>
                          {prettyProvider(prov)} · {feeLabel(prov)}
                        </option>
                      ))}
                    </select>
                    {saving === p.key && <span className="text-xs text-ink-400">saving…</span>}
                  </div>
                  <p className="text-[11px] text-ink-400">{p.hint}</p>
                </div>
              </div>
            )
          })}
        </div>

        {options.length === 0 ? (
          <p className="text-xs text-amber-600 mt-3">
            Connect a payment provider (Stripe, Razorpay, …) below — then you can route Desktop/Web to it and compare fees.
          </p>
        ) : (
          <p className="text-[11px] text-ink-400 mt-3">
            Fees are the provider's domestic rate from the method registry — lower routes cheaper. Cross-border adds each provider's FX markup.
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      </CardBody>
    </Card>
  )
}
