// OpenNext Cloudflare adapter config for the PayCraft dashboard.
// Defaults are correct for a standard Next.js 14 App Router app on Cloudflare
// Workers. No incremental-cache/queue/tag-cache overrides yet — the dashboard's
// /api routes are `no-store` (see next.config headers) and pages are dynamic, so
// there's no ISR surface to wire a KV/R2 cache to. Add an R2/KV incremental cache
// here later if any route opts into `revalidate`.
import { defineCloudflareConfig } from "@opennextjs/cloudflare"

export default defineCloudflareConfig()
