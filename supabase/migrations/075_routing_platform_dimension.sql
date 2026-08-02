-- 075_routing_platform_dimension.sql
-- Adds a per-platform dimension to the commercial routing engine so a tenant can say
-- "Stripe on desktop/web, Google Play on Android, StoreKit on iOS" — orthogonal to the
-- store-compliance lane (resolveCheckoutLane) which still forces native store on native.
--
-- The router (dashboard/lib/checkout-router.ts) and the SDK config edge function
-- (supabase/functions/config/index.ts) match a rule when its platform is the caller's
-- platform OR 'any'. Existing rows default to 'any' so behaviour is unchanged until a
-- tenant adds a platform-specific rule.
--
-- Idempotent per PayCraft migration rules (ADD COLUMN IF NOT EXISTS, guarded CHECK, DROP
-- POLICY-less; safe under `supabase db reset`).

-- 1. Platform column (nullable-safe default 'any', constrained to the SDK PlatformInfo set).
ALTER TABLE public.tenant_routing_rules
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'any';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_routing_rules_platform_chk'
  ) THEN
    ALTER TABLE public.tenant_routing_rules
      ADD CONSTRAINT tenant_routing_rules_platform_chk
      CHECK (platform IN ('ios', 'android', 'desktop', 'web', 'any'));
  END IF;
END $$;

UPDATE public.tenant_routing_rules SET platform = 'any' WHERE platform IS NULL;

-- 2. Replace the upsert RPC to accept p_platform. Drop the old 6-arg signature first so the
--    name does not become an ambiguous overload (the dashboard API is updated in lockstep to
--    call the 7-arg form).
DROP FUNCTION IF EXISTS public.tenant_routing_rules_upsert(uuid, text, text, text, text[], int);

CREATE OR REPLACE FUNCTION public.tenant_routing_rules_upsert(
  p_tenant_id        UUID,
  p_country_code     TEXT,
  p_currency         TEXT,
  p_product_type     TEXT,
  p_priority_methods TEXT[],
  p_priority         INT,
  p_platform         TEXT DEFAULT 'any'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_platform TEXT := COALESCE(NULLIF(p_platform, ''), 'any');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF v_platform NOT IN ('ios', 'android', 'desktop', 'web', 'any') THEN
    RAISE EXCEPTION 'platform must be one of ios/android/desktop/web/any';
  END IF;

  -- Validate every method in the priority list.
  IF EXISTS (
    SELECT 1 FROM unnest(p_priority_methods) AS m
    WHERE m NOT IN (SELECT method FROM provider_method_registry)
  ) THEN
    RAISE EXCEPTION 'priority_methods contains unknown method names';
  END IF;

  INSERT INTO tenant_routing_rules
    (tenant_id, country_code, currency, product_type, priority_methods, priority, platform)
  VALUES
    (p_tenant_id, NULLIF(p_country_code, ''), NULLIF(p_currency, ''),
     NULLIF(p_product_type, ''), p_priority_methods, COALESCE(p_priority, 100), v_platform)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.tenant_routing_rules_upsert(uuid, text, text, text, text[], int, text)
  TO authenticated;
