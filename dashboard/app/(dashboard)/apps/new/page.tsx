"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

type AppRow = { id: string; name: string }

export default function NewAppPage() {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apps, setApps] = useState<AppRow[]>([])
  // Provider setup choice. Default to reusing the account's existing connections
  // when the account already has another app — one provider secret serves many apps.
  const [providerMode, setProviderMode] = useState<"reuse" | "later">("later")
  const [reuseFrom, setReuseFrom] = useState<string>("")
  const router = useRouter()

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/apps", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        const list: AppRow[] = Array.isArray(data) ? data : data.apps ?? []
        setApps(list)
        if (list.length > 0) {
          setProviderMode("reuse")
          setReuseFrom(list[0].id)
        }
      } catch {
        /* non-fatal — the form still works with "connect later" */
      }
    })()
  }, [])

  async function create() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      let tenantId: string
      if (providerMode === "reuse" && reuseFrom) {
        // Full onboarding: create the tenant, INHERIT the source app's connected
        // providers (same secret, many apps), and seed default products. Sync is
        // left to the product page's live dialog (keeps this request cap-safe).
        const res = await fetch("/api/onboarding/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            app_name: name.trim(),
            inherit_providers_from: reuseFrom,
            seed_products: true,
            sync: false,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to create app")
        tenantId = data.tenant_id
      } else {
        // Create only — the user will connect providers later.
        const res = await fetch("/api/apps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to create app")
        tenantId = data.tenant_id
      }

      await fetch("/api/apps/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      })
      router.push(`/apps/${tenantId}`)
      router.refresh()
    } catch (e: any) {
      setError(String(e.message ?? e))
      setCreating(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto pt-16">
      <Link
        href="/apps"
        className="flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to apps
      </Link>

      <div className="mb-8">
        <div className="w-12 h-12 rounded-2xl bg-brand-100 flex items-center justify-center mb-4">
          <Smartphone className="w-6 h-6 text-brand-600" />
        </div>
        <h1 className="text-2xl font-extrabold text-ink-900">Register a new app</h1>
        <p className="text-ink-500 text-sm mt-1">
          Each app gets its own API key. Providers can be shared across your apps —
          connect once, reuse everywhere.
        </p>
      </div>

      <Card>
        <CardBody className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
              App name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Reels Downloader, Athani..."
              autoFocus
              className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
            <p className="text-xs text-ink-400">
              This name is shown in your dashboard only — not visible to your users.
            </p>
          </div>

          {/* #1 — Providers: reuse the account's existing connections or add later. */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
              Payment providers
            </label>
            <div className="space-y-2">
              <label
                className={
                  "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors " +
                  (providerMode === "reuse" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300") +
                  (apps.length === 0 ? " opacity-50 pointer-events-none" : "")
                }
              >
                <input
                  type="radio"
                  name="providerMode"
                  className="mt-0.5"
                  checked={providerMode === "reuse"}
                  disabled={apps.length === 0}
                  onChange={() => setProviderMode("reuse")}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink-900">Use my existing connected providers</div>
                  <p className="text-xs text-ink-500 mt-0.5">
                    Reuse Stripe / Razorpay / Google Play / App Store from another app — one secret, many apps.
                  </p>
                  {providerMode === "reuse" && apps.length > 0 && (
                    <select
                      value={reuseFrom}
                      onChange={(e) => setReuseFrom(e.target.value)}
                      className="mt-2 w-full px-3 py-2 bg-white border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                    >
                      {apps.map((a) => (
                        <option key={a.id} value={a.id}>
                          Copy providers from “{a.name}”
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <label
                className={
                  "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors " +
                  (providerMode === "later" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300")
                }
              >
                <input
                  type="radio"
                  name="providerMode"
                  className="mt-0.5"
                  checked={providerMode === "later"}
                  onChange={() => setProviderMode("later")}
                />
                <div>
                  <div className="text-sm font-medium text-ink-900">Connect providers later</div>
                  <p className="text-xs text-ink-500 mt-0.5">Create the app now; connect Stripe and the stores from its settings.</p>
                </div>
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={create}
            disabled={!name.trim() || creating}
            className="w-full justify-center"
          >
            {creating ? "Creating…" : "Create app"}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
