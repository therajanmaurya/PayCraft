"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, XCircle, Loader2, MinusCircle, X } from "lucide-react"
import { createClient } from "@/lib/supabase-browser"

type SyncEvent = {
  id: number
  run_id: string
  product_name: string | null
  provider: string | null
  phase: string // start | ok | skipped | failed | run_done
  status: string | null
  message: string
}

/**
 * Professional live sync-status dialog. The caller pre-generates a run id,
 * renders this dialog (which subscribes to sync_events over Realtime for that
 * run), then `onStart()` fires the actual per-provider sync requests — all
 * sharing the run id. Each (product × provider) row updates live from
 * "Syncing…" → ✓ synced / ⊘ skipped / ✗ failed, with a human message and an
 * overall progress bar. Works for one product or a full "sync all" (e.g. 4
 * products × 5 providers = 20 rows streaming in).
 */
export function SyncStatusDialog({
  open,
  runId,
  title,
  expectedRows,
  onStart,
  onClose,
}: {
  open: boolean
  runId: string
  title?: string
  expectedRows?: number
  onStart: () => Promise<void>
  onClose: () => void
}) {
  const [events, setEvents] = useState<SyncEvent[]>([])
  const [finished, setFinished] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!open || !runId) return
    setEvents([])
    setFinished(false)
    started.current = false
    const supabase = createClient()
    const channel = supabase.channel(`sync-run:${runId}`)
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "sync_events", filter: `run_id=eq.${runId}` },
      (payload) => setEvents((prev) => [...prev, payload.new as SyncEvent])
    )
    channel.subscribe(async (status) => {
      // Fire the sync requests only AFTER the subscription is live, so no early
      // events are missed.
      if (status === "SUBSCRIBED" && !started.current) {
        started.current = true
        try {
          await onStart()
        } finally {
          setFinished(true)
        }
      }
    })
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId])

  // Collapse start→result into one live row per (product, provider): the latest
  // event for each key wins, so a row updates in place rather than appending.
  const rows = useMemo(() => {
    const byKey = new Map<string, SyncEvent>()
    for (const e of events) {
      if (!e.provider) continue
      byKey.set(`${e.product_name ?? ""}:${e.provider}`, e)
    }
    return Array.from(byKey.values())
  }, [events])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [rows.length])

  const terminal = rows.filter((r) => r.phase !== "start").length
  const total = Math.max(expectedRows ?? rows.length, terminal, 1)
  const pct = Math.min(100, Math.round((terminal / total) * 100))
  const failed = rows.filter((r) => r.phase === "failed").length
  const allDone = finished && terminal >= rows.length && rows.length > 0

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">{title ?? "Syncing to providers"}</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {terminal} of {total} steps{failed > 0 ? ` · ${failed} failed` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className={"h-full rounded-full transition-all duration-300 " + (failed > 0 && allDone ? "bg-amber-500" : "bg-brand-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div ref={listRef} className="max-h-80 space-y-1.5 overflow-y-auto px-5 py-4">
          {rows.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting sync…
            </div>
          )}
          {rows.map((r) => (
            <div key={`${r.product_name}:${r.provider}`} className="flex items-start gap-2.5 text-sm">
              <EventIcon phase={r.phase} />
              <span
                className={
                  r.phase === "failed"
                    ? "text-rose-700"
                    : r.phase === "skipped"
                      ? "text-ink-400"
                      : r.phase === "ok"
                        ? "text-ink-700"
                        : "text-ink-600"
                }
              >
                {r.message}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3">
          <span className="text-xs text-ink-500">
            {allDone ? (failed > 0 ? `Completed — ${failed} need attention` : "All synced ✓") : "Syncing…"}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-ink-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink-800"
          >
            {allDone ? "Done" : "Close"}
          </button>
        </div>
      </div>
    </div>
  )
}

function EventIcon({ phase }: { phase: string }) {
  if (phase === "ok") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
  if (phase === "skipped") return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />
  if (phase === "failed") return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-500" />
}
