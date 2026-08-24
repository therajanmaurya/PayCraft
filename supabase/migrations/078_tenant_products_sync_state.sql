-- 078 — durable per-product provider-sync state
--
-- Makes multi-provider product sync (base product + free-trial offer) DURABLE and
-- observable, so the live dashboard can:
--   1. sync immediately on save, and SHOW the per-provider outcome;
--   2. RETRY a failed provider with the real server reason;
--   3. NOT lose work if the user closes the tab mid-sync — the product is stamped
--      `pending` BEFORE the provider calls, so an interrupted run leaves a durable
--      marker a later visit / the unsynced banner picks up ("save for later").
--
-- Why derived null-id detection wasn't enough: the old `tenant_products_unsynced`
-- inferred "needs sync" from a NULL stripe/razorpay id — it could not see a product
-- whose BASE synced but whose FREE-TRIAL OFFER failed (play_product_id present,
-- offer DRAFT/failed), and carried no failure reason to show the operator.
--
-- Columns:
--   sync_status  overall rollup: pending | syncing | synced | partial | failed
--   sync_state   per-provider detail: { "<provider>": { status, error?, warning?, at } }
--   synced_at    last time every applicable provider reached `synced`
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; safe on `supabase db reset`.

-- ── 1. Columns ──────────────────────────────────────────────────────────
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_state  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS synced_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.tenant_products.sync_status IS
  'Provider-sync rollup: pending (saved, not yet confirmed) | syncing | synced | partial (some providers ok) | failed. Set pending before the provider fan-out so a tab-close mid-sync stays retryable.';
COMMENT ON COLUMN public.tenant_products.sync_state IS
  'Per-provider sync detail: {"google_play":{"status":"failed|draft|synced|skipped","error":"...","at":"ISO"}, ...}. Drives the dashboard retry + reason UI.';

-- ── 2. Backfill — don't light up the unsynced banner for already-synced rows.
-- A product that already carries a provider id (base product synced in a prior
-- run) is treated as `synced`; everything else stays `pending`.
UPDATE public.tenant_products
   SET sync_status = 'synced', synced_at = COALESCE(synced_at, updated_at, now())
 WHERE sync_status = 'pending'
   AND (
        stripe_product_id IS NOT NULL
     OR play_product_id IS NOT NULL
     OR app_store_product_id IS NOT NULL
     OR (razorpay_plan_id_by_currency IS NOT NULL AND razorpay_plan_id_by_currency <> '{}'::jsonb)
   );

-- ── 3. RPC — record the outcome of a sync attempt (admin-guarded) ────────
CREATE OR REPLACE FUNCTION public.tenant_products_set_sync_state(
  p_id     UUID,
  p_status TEXT,
  p_state  JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('pending','syncing','synced','partial','failed') THEN
    RAISE EXCEPTION 'invalid sync_status: %', p_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE tenant_products
     SET sync_status = p_status,
         -- Merge the provided per-provider detail over the existing map so a
         -- single-provider retry doesn't wipe the others' recorded state.
         sync_state  = CASE WHEN p_state IS NULL THEN sync_state ELSE sync_state || p_state END,
         synced_at   = CASE WHEN p_status = 'synced' THEN now() ELSE synced_at END
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.tenant_products_set_sync_state(UUID, TEXT, JSONB) IS
  'Record a product provider-sync attempt outcome. Merges per-provider detail into sync_state; stamps synced_at only on full success.';

GRANT EXECUTE ON FUNCTION public.tenant_products_set_sync_state(UUID, TEXT, JSONB) TO authenticated;

-- ── 4. RPC — products still needing sync (durable "save for later" source) ─
-- Superset of the null-id heuristic: a product needs (re)sync when it lacks the
-- provider's base id OR its recorded sync_status is not a terminal success. This
-- is what lets the unsynced banner retry a product whose free-trial OFFER failed
-- even though its base plan/product already synced.
CREATE OR REPLACE FUNCTION public.tenant_products_needs_sync(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (
  id               UUID,
  sku              TEXT,
  display_name     TEXT,
  type             product_type,
  billing_interval TEXT,
  base_price_cents INT,
  base_currency    TEXT,
  sync_status      TEXT,
  sync_reason      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT p.id, p.sku, p.display_name, p.type, p.interval AS billing_interval,
         p.base_price_cents, p.base_currency, p.sync_status,
         (p.sync_state -> p_provider ->> 'error') AS sync_reason
  FROM tenant_products p
  WHERE p.tenant_id = p_tenant_id
    AND p.active = TRUE
    AND (
      p.sync_status IN ('pending','syncing','partial','failed')
      OR (p_provider = 'stripe'    AND p.stripe_product_id IS NULL)
      OR (p_provider = 'razorpay'  AND (p.razorpay_plan_id_by_currency IS NULL OR p.razorpay_plan_id_by_currency = '{}'::jsonb))
      OR (p_provider = 'google_play' AND p.play_product_id IS NULL)
      OR (p_provider = 'app_store' AND p.app_store_product_id IS NULL)
      -- The provider recorded a non-synced state for THIS provider specifically.
      OR (p.sync_state -> p_provider ->> 'status') IN ('failed','draft','pending')
    )
  ORDER BY p.display_order, p.created_at;
END;
$$;

COMMENT ON FUNCTION public.tenant_products_needs_sync(UUID, TEXT) IS
  'Products needing (re)sync for a provider — null base-id OR non-terminal sync_status OR a per-provider failed/draft/pending state (catches free-trial-offer failures the null-id heuristic misses).';

GRANT EXECUTE ON FUNCTION public.tenant_products_needs_sync(UUID, TEXT) TO authenticated;
