# Changelog

## Unreleased

- **088** introduces the Offering → Package → Product model (`tenant_offerings`, `tenant_packages`)
  with RevenueCat-reserved role identifiers, plus a same-file backfill that maps every existing
  product to a role and RAISEs rather than leaving one unmapped. Role arms mirror the existing
  `tenant_products_interval_check` vocabulary (`month`/`quarter`/`semiannual`/`year`), not ISO-8601.
- **089** retires the 8× `tenant_products_upsert` copy-paste chain: `_tenant_products_upsert_core`
  owns the single column projection, the wrapper owns the auth guard and delegates. The core's
  EXECUTE is revoked from anon/authenticated — it is SECURITY DEFINER without an ownership guard.
- **090** locks D6: `is_entitlement_current` treats a NULL expiry as "does not expire", and the
  entitlement read path never joins `tenant_products.active`, so disabling a product hides it from
  the paywall but can never revoke a purchased entitlement. Adds `is_premium_by_app_user`.
- `/config` now fails loudly when the products query errors, instead of degrading a database
  failure into an empty product array behind HTTP 200.
- dashboard: `GET /api/products/[id]` added (was missing — F17); the pricing page renders the real
  row and shows an explicit failure state instead of a fabricated `Product` / `9.99` placeholder.
- dashboard: D6 disclosure rendered beside the product active toggle.
- **091 (security)** revokes `anon`/`PUBLIC` EXECUTE on `tenant_products_upsert`,
  `tenant_pricing_upsert`, `tenant_products_delete`, `sync_event_emit`,
  `tenant_providers_set_account_label` and `_tenant_products_upsert_core`. Migration 084's
  ownership guard bypasses on a NULL `auth.uid()` for the trusted backend, and assumed anon could
  not reach these RPCs — but PostgreSQL grants EXECUTE to PUBLIC by default, so a holder of the
  PUBLISHABLE anon key could write any tenant's products. Verified closed: `HTTP 401 permission
  denied`, zero rows written; `authenticated` and `service_role` unaffected.

## [Unreleased] — unified country detection + per-platform provider routing

Adds a unified, cross-platform buyer-country signal and platform-aware provider selection, without touching the shipped 2.3.x storefront/native-price billing core. See `paycraft-provider-platform-onboarding` epic.

### Added

- **Compliant, dashboard-driven free-trial disclosure** — the paywall now states the full trial terms Google Play's Subscriptions policy requires: each trial-eligible plan card discloses the **post-trial price + cadence** on the offer itself (`"14-day free trial, then ₹299 / month"`), and the disclosure block states the trial **auto-renews** into a paid subscription and **how to cancel** before being charged. All three strings are tenant-configurable from the dashboard (`PaywallDto.trial_terms_template` / `trial_disclosure_title` / `trial_disclosure_body`, migration `077`) with localized SDK string-resource fallbacks, so copy changes need no host rebuild. Resolves the Reels Downloader (`com.sensei.social`) rejection where the paywall advertised a trial without stating its terms. Roborazzi golden `product_list.png` re-recorded as render evidence. Sample app updated to `branded-stack` + a 14-day trial to showcase the disclosure.
- **Unified country detection** — `CountryDetector` (`cmp-paycraft/.../CountryDetector.kt`) folds a new signal order `store storefront → server IP-geo → device/SIM → config locale → DEFAULT`, each tagged with a `CountryProvenance` (`AUTHORITATIVE_STORE` / `SERVER_IP_GEO` / `DEVICE_SIM` / `LOCALE_FALLBACK`). The `/config` edge function reads the hosting edge IP-country header (`x-vercel-ip-country` / `cf-ipcountry` / `cloudfront-viewer-country`) and returns `geo_country` + `geo_source`, so web/desktop (no store storefront) get an authoritative country instead of only the device locale. `CurrencyResolver.resolveCountry` gained a backward-compatible `serverGeo` param; the SDK re-resolves post-fetch and sends `X-PayCraft-Platform`.
- **Per-platform provider routing** — migration `075` adds a `platform` dimension (`ios/android/desktop/web/any`) to `tenant_routing_rules` + the upsert RPC. `checkout-router.ts` matches on platform (`platformMatches`); `/config` orders `providers[]` by the tenant's platform routing preference (`orderProvidersByPlatform`) so the SDK's `primaryProvider()` is the intended provider per platform (Stripe on desktop, Razorpay on Android, …) instead of an arbitrary `firstOrNull()`. Dashboard smart-routing editor gains a Platform column. `resolveCheckoutLane` (store-compliance) is unchanged and remains the outer guard.

### Fixed

- **Versioned migrations** — `supabase/migrations/` was blanket-gitignored, silently dropping every schema change from version control on deploy. `075` is now tracked via a `.gitignore` negation, with a note to track future migrations the same way.

## [2.2.0] — Google Play Payments-policy compliance + native billing

Makes PayCraft compliant with Google Play's Payments policy: on Android, digital-subscription checkout now transacts through **Google Play Billing** instead of opening an external web payment page (the anti-steering violation that flagged consumer apps such as Reels Downloader `com.sensei.social`). Web/link-out remains the path on web/desktop and for physical goods.

### Added

- **Hybrid native + web checkout routing** — `billing/CheckoutLane.kt` (`resolveCheckoutLane(platform, plan, isDigital)`): Android + digital + a configured `playProductId` → native Google Play Billing (`NativeBillingClient.purchase()`); web/desktop/iOS or physical → existing web payment link. `openUrl()` is now reachable only in the `Web` lane.
- **Native Google Play Billing (v8) + StoreKit2 clients** wired into checkout (`PlayBillingNativeClient`, `StoreKit2NativeBillingClient` + Swift shim).
- **Anti-steering guard** — on Android + digital with no `playProductId`, the paywall fails closed (`BillingState.Error`) and never opens a browser.
- **Server entitlement grant** — `supabase/functions/register-play-purchase/` validates the Play purchase token (Play Developer API) and reconciles the entitlement.
- **Store product IDs in config** — `play_product_id` / `app_store_product_id` on `ProductDto` + `BillingPlan`, flowed DB → config → SDK (migration `073`).
- **Dashboard store-product sync** — per-product Google Play / App Store ID fields; per-tenant encrypted Play service-account + App Store Connect `.p8` credentials (migration `074`); auto-create/sync subscriptions on Google Play (`monetization.subscriptions`) + App Store Connect (`subscriptions`) with write-back.

### Changed

- Dropped `macosX64`/`macosArm64` targets (Store5 5.1.0-alpha08 ships no macOS artifact; macOS is not a shipped platform — re-add when Store5 supports it).

## [Unreleased] — paycraft-v2-production-readiness epic

Closes the 5-phase production-readiness epic spanning vault, domain, DR, observability, and Maven publish gates. See `plan-layer/project-plans/mbs/PayCraft/active/paycraft-v2-production-readiness/PLAN.md` for the full spec.

### Added

- **Phase 3 DR pipeline** — `.github/workflows/daily-backup.yml` (daily 02:00 UTC pg_dump → Cloudflare R2), `infra/restore-from-r2.sh` with prod guardrail, `docs/DR_RUNBOOK.md` with RPO=24h/RTO=4h + monthly drill checklist
- **Phase 3 PCI scope statement** — `docs/PCI_SCOPE.md` (SAQ-A, founder-signed)
- **Phase 3 DPA sub-processor table** — inline 9-row table on `/legal/dpa`
- **Phase 4 edge rate-limit** — `dashboard/lib/edge-rate-limit.ts` (per-IP token bucket) + middleware shed on `/api/*` mutating routes
- **Phase 4 webhook rate-limit fan-out** — `_shared/webhook-rate-limit.ts` shared `withWebhookRateLimit({bucket})` wrapper applied to all 11 webhook handlers (Stripe, Razorpay, Cashfree, BTCPay, Flutterwave, Lemonsqueezy, Midtrans, Paddle, PayPal, Paystack, cloud-billing) with per-IP fallback before signature verification
- **Phase 4 Sentry helpers** — `_shared/sentry.ts` (Deno edge) + `dashboard/lib/sentry-events.ts` (failed payment / webhook retry / rate-limit / key-rotated event builders)
- **Phase 4 support ticketing** — `supabase/migrations/064_support_tickets.sql` (RLS), `dashboard/app/api/support/ticket/route.ts`, `supabase/functions/support-to-linear/index.ts` (Linear fan-out + Resend auto-reply)
- **Phase 4 SLA + incident docs** — `docs/SLA_DASHBOARD.md` (99.5% / 99.9% / p95 ≤ 30s targets, upptime config), `docs/INCIDENT_SIMULATION.md` (3 rehearsable scenarios + drill log)
- **Phase 4 `charge.refunded`** — Stripe webhook now downgrades `subscriptions.status` to `canceled` on full refund
- **Phase 4 API key rotation tracking** — `supabase/migrations/065_api_key_rotated_at.sql` adds `api_key_{test,live}_rotated_at` timestamp columns; `/api/api-keys/rotate` writes them + emits Sentry breadcrumb
- **Phase 5 Maven Central README** — `cmp-paycraft/README.md` ready for Sonatype publish
- **Phase 5 real-world case study** — `docs/REELS_DOWNLOADER_INTEGRATION.md` (end-to-end adoption proof)
- **Phase 5 RLS isolation contract test** — `dashboard/__tests__/api/rls-isolation.test.ts` (11 tests, 5 tables, validates 42501 deny-by-default)

### Changed

- Canonical domain migrated from `paycraft.cloud` to `paycraft.mobilebytesensei.com` across dashboard pages, sample apps, KMP SDK, infrastructure docs, and README/CHANGELOG. v2.0 announcement section below retains the historical name.
- `cmp-paycraft.PayCraftBackend.Cloud` now targets the Supabase project URL directly (decoupled from any specific dashboard hostname)
- `dashboard/lib/email.ts` sender uses `${PAYCRAFT_EMAIL_FROM}` env-var with `no-reply@paycraft.mobilebytesensei.com` fallback

### Documentation

- `docs/STRIPE_ACTIVATION.md` — Phase 1 platform Stripe activation runbook (3-7 day window)
- `docs/PAYCRAFT_AS_TENANT_ONE.md` — Phase 1 dogfooding runbook
- `ROADMAP.md` — live phase tracker (new file)

## [2.0.0] - 2026-06-06

### Cloud SaaS launch — paycraft.cloud

PayCraft v2.0 ships `paycraft.cloud` as a managed billing SaaS: configure products, pricing,
paywall templates, and providers from a dashboard — your app code collapses to a single call.
In-code `PayCraft.configure {}` remains fully supported for teams that prefer it.

#### New — Cloud dashboard configuration path

```kotlin
PayCraft.initialize(apiKey = "pk_live_…")  // everything else from paycraft.cloud
```

- **Thin SDK init** — `PayCraft.initialize(apiKey, backend?)`. All config fetched via `/v2/config`
  with offline cache (`SuiteConfig` — products, providers, pricing, paywall, branding, locale).
- **`PayCraftBackend`** — `Cloud` (default), `SelfHosted(supabaseUrl, supabaseAnonKey)`, `Mock` (testing).
- **3 paywall templates** — `Minimal`, `Premium`, `Dark` — selectable in the dashboard, rendered
  client-side from `SuiteConfig.paywall.template`. Custom templates via `PayCraftPaywall(content = …)`.
- **`MobileByteSenseiTheme`** — default paywall theme with PayCraft brand tokens; per-tenant
  override via dashboard.

#### New — Provider bottom sheet + branding

- **`ProviderPicker`** sealed interface — `AutoSkipWhenSingle` (default), `BottomSheet(maxVisible)`,
  `Inline` strategies. Multi-provider tenants see a locale-filtered provider selection sheet.
- **`Branding`** sealed interface — `Attribution` (Free tier, shows "Powered by PayCraft"),
  `None` (Pro+), `Custom(footer)` (Enterprise). Rendered via `BrandingFooter` composable.

#### New — Dashboard

Next.js 14 dashboard at `paycraft.cloud`:

- Onboarding wizard — app creation → provider OAuth → first product → API key
- Product/pricing manager — Subscription, Trial, Lifetime types; per-country pricing
- Paywall designer — live preview with template + theme controls
- Provider management — Stripe Connect OAuth, Razorpay, Paddle; multi-provider ordering
- Analytics — MRR, churn, subscriber growth; per-cohort + A/B experiments
- Team & billing — RBAC (Owner / Admin / Viewer), tier enforcement, upgrade flow
- Audit log — all dashboard actions with actor, timestamp, diff

#### New — Production infrastructure (Phase 13)

- Cloudflare DNS + Vercel deployment with security headers (HSTS, CSP, X-Frame-Options)
- Sentry error tracking (client + server)
- BetterStack uptime monitoring + SLA dashboard
- Postmark transactional emails (6 templates: welcome, team-invite, limit-warn, limit-hit, webhook-fail, sub-expiry)
- Rate limiting policy + GDPR/SOC2 compliance docs
- CI/CD: 3-job deploy pipeline + smoke test workflow

#### New — Server (Phases 1–2)

- 7 new Supabase migrations (028–034): `paycraft_tenants`, `paycraft_api_keys`,
  `paycraft_products`, `paycraft_providers`, `paycraft_paywall_config`, `paycraft_usage_events`,
  `paycraft_team_members`
- 3 new Edge Functions: `/v2/config` (suite config fetch), `/v2/billing` (event ingestion),
  `stripe-connect-oauth` (provider auth flow)

#### New — Self-host Enterprise (Phase 11)

- `PayCraftBackend.SelfHosted(supabaseUrl, supabaseAnonKey)` overload
- `SELF_HOST_GUIDE.md` + Helm chart + Docker Compose stack + license key validation

#### Preserved unchanged

- `PayCraft.configure {}` — fully supported in-code configuration path
- `BillingManager`, `SyncPolicy`, `PayCraftService` engine
- `PayCraftPaywall()` composable signature unchanged
- Webhooks, migrations 014–027 (including trial schema 026/027 from v1.1)
- 17 unit tests + 7 SQL assertions from v1.1 trial support

#### Configuration path comparison

| | In-code | Cloud dashboard |
|---|---|---|
| Config location | Kotlin source | paycraft.cloud |
| SDK call | `PayCraft.configure { … }` | `PayCraft.initialize(apiKey)` |
| Price change | Code change + release | Dashboard edit — live instantly |
| Paywall template | Code | Dashboard |
| Self-host | ✅ native | ✅ `SelfHosted` backend |

Migration guide: [docs/MIGRATION_V2.md](docs/MIGRATION_V2.md)

---

## [1.4.0] - 2026-04-28

### Added
- **Smart sync cache-first billing** — `PayCraftBillingManager` now reads cached `SubscriptionStatus` synchronously in `init`, eliminating the `Loading` flash on app launch. Supabase is only called when the cache is stale or missing.
- **`SyncPolicy`** — tiered sync intervals based on subscription state:
  - Weekly: premium with >7 days to expiry
  - Daily: free users, cancelled subscriptions, or 1-7 days to expiry
  - Hourly: <24 hours to expiry (catches renewals/expirations quickly)
- **`refreshStatus(force: Boolean = false)`** — new parameter on `BillingManager.refreshStatus()`. Default (`false`) respects `SyncPolicy`; pass `true` to always fetch from Supabase (e.g., post-checkout polling).
- **`PayCraftStore` cache methods** — `cacheSubscriptionStatus()`, `getCachedSubscriptionStatus()`, `getLastSyncedAt()`, `clearCache()` with default no-op implementations for backward compatibility.
- **`PayCraftSettingsStore` cache persistence** — cached status stored via `multiplatform-settings` (survives app restarts).
- **`currentTimeMillis()` expect/actual** — KMP time provider for Android, JVM, iOS, macOS, JS, and WasmJS.

### Changed
- `refreshStatus()` default behavior changed from always-fetch to smart sync. This is source-compatible but a **behavioral change**.
- `logOut()` and `revokeCurrentDevice()` now clear the subscription cache.
- `applyPremiumResult()` now writes to cache after every successful Supabase sync.

### Migration Guide
If your app calls `refreshStatus()` after a payment checkout (e.g., returning from Stripe), update to:
```kotlin
billingManager.refreshStatus(force = true)
```
All other call sites (init, ON_RESUME, screen transitions) work correctly with the new smart sync default.

## [1.3.0] - 2026-04-27

### Added
- Device conflict resolution (OAuth Gate 1 + OTP Gate 2)
- `confirmDeviceTransfer()` for explicit user-confirmed transfers
- `OwnershipVerified` billing state with verification method tracking
- Comprehensive `PayCraftLogger` debug logging
