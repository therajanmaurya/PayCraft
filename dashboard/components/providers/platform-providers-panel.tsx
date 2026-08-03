"use client"

import { useState } from "react"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Platform → provider selector (migration 075 routing engine, surfaced as a first-class panel).
 *
 * Lets a merchant pick which payment provider each app platform uses:
 *   - iOS / Android — digital subscriptions ALWAYS transact through the native store (App Store /
 *     Google Play) per Apple 3.1.1 / Google Play Payments policy. That is enforced by the SDK's
 *     compliance lane (`resolveCheckoutLane`) and is NOT routable, so these rows are shown as
 *     automatic (informational). The dropdown sets the WEB-lane / physical-goods fallback provider.
 *   - Desktop / Web — no native store, so the merchant picks the PSP freely. Selecting one writes a
 *     `platform=<p>` routing rule (country/currency/product-type = any) that `/config` uses to order
 *     `providers[]` so the SDK's primary provider on that platform is the chosen one.
 *
 * Each save replaces the platform's existing rule (delete-then-create) so a platform maps to exactly
 * one preferred provider.
 */

interface RegistryRow {
  method: string
  provider: string
  display_name: string
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

export function PlatformProvidersPanel({
  registry,
  connectedProviders,
  initialRules,
}: {
  registry: RegistryRow[]
  connectedProviders: string[]
  initialRules: RoutingRule[]
}) {
  // provider → its cheapest configured method (first in the fee-sorted registry)
  const providerMethod = new Map<string, string>()
  for (const r of registry) if (!providerMethod.has(r.provider)) providerMethod.set(r.provider, r.method)
  // only providers this tenant has connected AND that have a routable web method
  const options = [...new Set(connectedProviders)].filter((p) => providerMethod.has(p))

  // current platform → provider, derived from the platform-specific routing rules
  const initial: Record<string, string> = {}
  for (const rule of initialRules) {
    if (!rule.platform || rule.platform === "any") continue
    const method = rule.priority_methods?.[0]
    const provider = registry.find((r) => r.method === method)?.provider
    if (provider) initial[rule.platform] = provider
  }
  const ruleIdByPlatform = new Map<string, string>()
  for (const rule of initialRules) if (rule.platform && rule.platform !== "any") ruleIdByPlatform.set(rule.platform, rule.id)

  const [selection, setSelection] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(platform: string, provider: string) {
    setError(null)
    setSaving(platform)
    setSelection((s) => ({ ...s, [platform]: provider }))
    try {
      // Replace any existing rule for this platform so it maps to exactly one provider.
      const existingId = ruleIdByPlatform.get(platform)
      if (existingId) {
        await fetch(`/api/routing-rules/${existingId}`, { method: "DELETE" })
        ruleIdByPlatform.delete(platform)
      }
      if (provider) {
        const method = providerMethod.get(provider)
        const res = await fetch("/api/routing-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            platform,
            priority_methods: method ? [method] : [],
            country_code: null,
            currency: null,
            product_type: null,
            priority: 50,
          }),
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

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Platform providers</h2>
          <Badge>migration 075</Badge>
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          Choose which provider each platform of your app uses. iOS and Android digital subscriptions
          are handled by the native store automatically; Desktop and Web are yours to route.
        </p>

        <div className="space-y-2.5">
          {PLATFORMS.map((p) => (
            <div key={p.key} className="grid grid-cols-[110px_1fr] items-center gap-3 py-2 border-t border-ink-100 first:border-t-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink-900">{p.label}</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {p.native && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-700 bg-ink-50 border border-ink-200 rounded-md px-2 py-1">
                      {p.native}
                      <Badge>auto</Badge>
                    </span>
                  )}
                  <select
                    value={selection[p.key] ?? ""}
                    disabled={saving === p.key || options.length === 0}
                    onChange={(e) => save(p.key, e.target.value)}
                    className="min-w-[180px] px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 disabled:opacity-60"
                    aria-label={`${p.label} provider`}
                  >
                    <option value="">{p.native ? "Web fallback: default (cheapest)" : "Default (cheapest eligible)"}</option>
                    {options.map((prov) => (
                      <option key={prov} value={prov}>
                        {prov.charAt(0).toUpperCase() + prov.slice(1).replace(/[-_]/g, " ")}
                      </option>
                    ))}
                  </select>
                  {saving === p.key && <span className="text-xs text-ink-400">saving…</span>}
                </div>
                <p className="text-[11px] text-ink-400">{p.hint}</p>
              </div>
            </div>
          ))}
        </div>

        {options.length === 0 && (
          <p className="text-xs text-amber-600 mt-3">
            Connect a payment provider (Stripe, Razorpay, …) first — then you can route Desktop/Web to it.
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      </CardBody>
    </Card>
  )
}
