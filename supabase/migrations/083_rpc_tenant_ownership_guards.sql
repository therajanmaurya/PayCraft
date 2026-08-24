-- 083_rpc_tenant_ownership_guards.sql
-- PRODUCTION SECURITY: close cross-tenant IDOR on the products/pricing write RPCs.
--
-- tenant_products_upsert / tenant_products_delete / tenant_pricing_bulk_upsert /
-- tenant_pricing_upsert are SECURITY DEFINER (bypass RLS) and GRANTed to
-- `authenticated`, but took the target tenant_id straight from their arguments
-- with NO ownership check. Any logged-in user could POST directly to
-- /rest/v1/rpc/<fn> with another tenant's id and overwrite/delete that tenant's
-- products + prices (inject a product, zero a competitor's price, soft-delete).
-- The dashboard calls these as the authenticated admin, so we ADD the same
-- tenant_admins/auth.uid() guard the sibling RPCs (tenant_coupons_*,
-- tenant_paywall_upsert, ...) already enforce — rather than revoking EXECUTE,
-- which would break the dashboard's own product/pricing saves.
--
-- Idempotent: CREATE OR REPLACE with the exact live body + a fail-closed guard.

CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = (p_row->>'tenant_id')::uuid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_enabled, trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    pricing_mode, global_price_cents, global_currency,
    discount_percent, discount_ends_at,
    play_product_id, app_store_product_id
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    COALESCE((p_row->>'trial_enabled')::BOOLEAN, true),
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true),
    COALESCE((p_row->>'pricing_mode')::pricing_mode, 'auto'::pricing_mode),
    NULLIF(p_row->>'global_price_cents','')::INT,
    NULLIF(p_row->>'global_currency',''),
    NULLIF(p_row->>'discount_percent','')::INT,
    NULLIF(p_row->>'discount_ends_at','')::TIMESTAMPTZ,
    NULLIF(p_row->>'play_product_id',''),
    NULLIF(p_row->>'app_store_product_id','')
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_enabled          = EXCLUDED.trial_enabled,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        pricing_mode           = EXCLUDED.pricing_mode,
        global_price_cents     = EXCLUDED.global_price_cents,
        global_currency        = EXCLUDED.global_currency,
        discount_percent       = EXCLUDED.discount_percent,
        discount_ends_at       = EXCLUDED.discount_ends_at,
        play_product_id        = EXCLUDED.play_product_id,
        app_store_product_id   = EXCLUDED.app_store_product_id,
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_pricing_upsert(p_row jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = (p_row->>'tenant_id')::uuid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO tenant_pricing(id, tenant_id, product_id, locale, amount_cents, currency, source, source_ref)
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    (p_row->>'product_id')::UUID,
    UPPER(p_row->>'locale'),
    (p_row->>'amount_cents')::INT,
    p_row->>'currency',
    COALESCE((p_row->>'source')::pricing_source, 'manual'),
    p_row->>'source_ref'
  )
  ON CONFLICT (tenant_id, product_id, locale) DO UPDATE
    SET amount_cents = EXCLUDED.amount_cents,
        currency     = EXCLUDED.currency,
        source       = EXCLUDED.source,
        source_ref   = EXCLUDED.source_ref,
        updated_at   = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_pricing_bulk_upsert(p_tenant_id uuid, p_product_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n INT := 0;
  rec JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR rec IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    PERFORM tenant_pricing_upsert(rec || jsonb_build_object('tenant_id', p_tenant_id, 'product_id', p_product_id));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_products_delete(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_products tp
    JOIN tenant_admins ta ON ta.tenant_id = tp.tenant_id
    WHERE tp.id = p_id AND ta.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE tenant_products SET active = false, updated_at = now() WHERE id = p_id;
END;
$function$;
