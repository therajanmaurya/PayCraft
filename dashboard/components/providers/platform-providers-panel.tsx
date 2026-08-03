"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Per-platform primary + fallback provider selector (migration 075 routing engine).
 *
 * For each app platform the merchant picks a PRIMARY provider and an optional FALLBACK provider used
 * when the primary can't serve a customer. Saved per platform as a routing rule whose ordered
 * `priority_methods` is `[primary, fallback]`.
 *
 * iOS/Android digital subscriptions always transact through the native store (App Store / Google
 * Play) per store policy — shown as an automatic badge. The primary/fallback dropdowns govern the
 * web-lane (physical goods / non-digital) on those platforms, and full checkout on Desktop/Web.
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
}
const PLATFORMS: { key: string; label: string; native?: string; nativeHref?: string }[] = [
  { key: "ios", label: "iOS", native: "App Store (StoreKit 2)", nativeHref: "/providers/app-store" },
  { key: "android", label: "Android", native: "Google Play Billing", nativeHref: "/providers/google-play" },
  { key: "desktop", label: "Desktop" },
  { key: "web", label: "Web" },
]

type Sel = { primary: string; fallback: string }

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
  const methodToProvider = new Map<string, string>()
  for (const r of registry) methodToProvider.set(r.method, r.provider)
  // connected web providers, cheapest first — the options for both dropdowns
  const options = [...providerInfo.keys()]
    .filter((p) => connected.has(p))
    .sort((a, b) => providerInfo.get(a)!.fee - providerInfo.get(b)!.fee)

  const fee = (p: string) => {
    const f = providerInfo.get(p)?.fee
    return f != null && f < 99 ? ` · ${f}%` : ""
  }
  const pretty = (p: string) => DISPLAY[p] ?? p

  // load per-platform selections from routing rules (priority_methods = [primary, fallback])
  const initSel: Record<string, Sel> = {}
  const ruleIdByPlatform: Record<string, string> = {}
  for (const rule of initialRules) {
    const plat = rule.platform
    if (!plat || plat === "any") continue
    if (rule.country_code || rule.currency || rule.product_type) continue
    ruleIdByPlatform[plat] = rule.id
    const primary = methodToProvider.get(rule.priority_methods?.[0] ?? "") ?? ""
    const fallback = methodToProvider.get(rule.priority_methods?.[1] ?? "") ?? ""
    initSel[plat] = { primary, fallback }
  }

  const [sel, setSel] = useState<Record<string, Sel>>(initSel)
  const [ruleIds, setRuleIds] = useState<Record<string, string>>(ruleIdByPlatform)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(platform: string, next: Sel) {
    setError(null)
    setSaving(platform)
    setSaved(null)
    setSel((s) => ({ ...s, [platform]: next }))
    try {
      const existing = ruleIds[platform]
      if (existing) {
        await fetch(`/api/routing-rules/${existing}`, { method: "DELETE" }).catch(() => {})
        setRuleIds((r) => {
          const c = { ...r }
          delete c[platform]
          return c
        })
      }
      // ordered [primary, fallback], drop empties/dupes, map to methods
      const providers = [next.primary, next.fallback].filter((p, i, a) => p && connected.has(p) && a.indexOf(p) === i)
      const methods = providers.map((p) => providerInfo.get(p)?.method).filter(Boolean) as string[]
      if (methods.length > 0) {
        const res = await fetch("/api/routing-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform, priority_methods: methods, country_code: null, currency: null, product_type: null, priority: 20 }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error ?? `save failed (${res.status})`)
        }
        const { id } = await res.json()
        if (id) setRuleIds((r) => ({ ...r, [platform]: id }))
      }
      setSaved(platform)
      setTimeout(() => setSaved((cur) => (cur === platform ? null : cur)), 2500)
    } catch (e: any) {
      setError(`${platform}: ${e?.message ?? "save failed"}`)
    } finally {
      setSaving(null)
    }
  }

  const noProviders = options.length === 0

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-ink-900">Platform providers</h2>
          <Badge>primary + fallback</Badge>
        </div>
        <p className="text-xs text-ink-500 mb-4 max-w-2xl">
          For each platform, pick a <strong>primary</strong> provider and an optional{" "}
          <strong>fallback</strong> used when the primary can't serve a customer. Saves instantly.
          iOS &amp; Android digital subscriptions always use the native store; the dropdowns route the
          web / physical-goods lane there, and full checkout on Desktop / Web.
        </p>

        {noProviders ? (
          <p className="text-xs text-amber-600">
            Connect a payment provider (
            <Link href="/providers" className="font-semibold text-brand-600">Providers</Link>
            ) first — then set a primary + fallback per platform.
          </p>
        ) : (
          <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
            {/* header */}
            <div className="hidden sm:grid grid-cols-[120px_1fr_1fr] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">
              <span>Platform</span>
              <span>Primary</span>
              <span>Fallback</span>
            </div>
            {PLATFORMS.map((p) => {
              const cur = sel[p.key] ?? { primary: "", fallback: "" }
              return (
                <div key={p.key} className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr] gap-3 px-4 py-3 items-center">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink-900">{p.label}</span>
                    {p.native && (
                      <Link href={p.nativeHref ?? "#"} className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink-600 bg-ink-50 border border-ink-200 rounded px-1.5 py-0.5">
                        {connected.has(p.key === "ios" ? "app_store" : "google_play") ? "" : "connect "}native
                        <Badge>auto</Badge>
                      </Link>
                    )}
                  </div>

                  {/* Primary */}
                  <ProviderSelect
                    label="Primary"
                    value={cur.primary}
                    placeholder="Auto — cheapest"
                    options={options}
                    pretty={pretty}
                    fee={fee}
                    disabled={saving === p.key}
                    onChange={(v) => save(p.key, { primary: v, fallback: cur.fallback === v ? "" : cur.fallback })}
                  />

                  {/* Fallback (excludes the chosen primary) */}
                  <div className="flex items-center gap-2">
                    <ProviderSelect
                      label="Fallback"
                      value={cur.fallback}
                      placeholder="None"
                      options={options.filter((o) => o !== cur.primary)}
                      pretty={pretty}
                      fee={fee}
                      disabled={saving === p.key || !cur.primary}
                      onChange={(v) => save(p.key, { primary: cur.primary, fallback: v })}
                    />
                    {saving === p.key && <span className="text-[11px] text-ink-400">saving…</span>}
                    {saved === p.key && <span className="text-[11px] font-semibold text-emerald-600">✓ saved</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-[11px] text-ink-400 mt-3">
          Fees are the provider's domestic rate — lower routes cheaper. Cross-border adds each
          provider's FX markup. Fallback applies only after a primary is set.
        </p>
      </CardBody>
    </Card>
  )
}

function ProviderSelect({
  label,
  value,
  placeholder,
  options,
  pretty,
  fee,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  options: string[]
  pretty: (p: string) => string
  fee: (p: string) => string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500 disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {pretty(p)}{fee(p)}
        </option>
      ))}
    </select>
  )
}
