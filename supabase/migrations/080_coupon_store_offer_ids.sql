-- Migration 080 — store per-product native-store offer ids created for a coupon.
--
-- A PayCraft coupon (percent_off) now also syncs to Google Play + App Store as a
-- discounted subscription OFFER (lib/googleplay-coupon-sync.ts,
-- lib/appstore-coupon-sync.ts) — the store equivalent of a coupon. Because store
-- offers are PER-SUBSCRIPTION (unlike the single Stripe coupon / Razorpay offer),
-- we record a { paycraft_product_id -> store_offer_id } map per provider so
-- re-syncs are idempotent and the dashboard can show what was created.
-- Idempotent: pure ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.tenant_coupons
  ADD COLUMN IF NOT EXISTS googleplay_offer_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS appstore_offer_ids   JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_coupons.googleplay_offer_ids IS
  '{ paycraft_product_id: play_offer_id } created by googleplay-coupon-sync. {} when no Play connection / no synced subscriptions.';
COMMENT ON COLUMN public.tenant_coupons.appstore_offer_ids IS
  '{ paycraft_product_id: appstore_intro_offer_id } created by appstore-coupon-sync. {} when no App Store connection / no synced subscriptions.';
