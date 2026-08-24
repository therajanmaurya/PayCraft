-- 081_realtime_foundation.sql
-- Realtime "everywhere" foundation.
--
-- Two mechanisms:
--   1. DASHBOARD (authenticated admins) → Postgres CDC via the `supabase_realtime`
--      publication. The dashboard browser client subscribes to `postgres_changes`
--      on the tenant tables (filtered by tenant_id) and refreshes live. These tables
--      already carry tenant_admin SELECT RLS, so realtime respects tenant isolation.
--   2. SDK (end-user apps, no Supabase-auth JWT) → Realtime BROADCAST pings. DB
--      triggers call realtime.send() to PUBLIC channels carrying only an
--      invalidation signal (never row data). The SDK receives the ping and refetches
--      through its existing api-key/identity-scoped RPCs, so no secret ever crosses
--      the channel and no end-user RLS model is required.
--
-- Channels:
--   config:{tenant_id}                     ← tenant_products / _pricing / _paywall / _coupons change
--   entitlement:{tenant_id}:{app_user_id}  ← entitlement_records change
--
-- Idempotent: safe to re-run (guards on publication membership; CREATE OR REPLACE
-- functions; DROP TRIGGER IF EXISTS before CREATE).

-- ---------------------------------------------------------------------------
-- 1. REPLICA IDENTITY FULL — so postgres_changes UPDATE/DELETE payloads carry the
--    full old row, letting the dashboard filter on tenant_id (a non-PK column).
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_products  REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_pricing   REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_paywall   REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_coupons   REPLICA IDENTITY FULL;
ALTER TABLE public.subscriptions    REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 2. Add the dashboard tables to the supabase_realtime publication (idempotent).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tenant_products','tenant_pricing','tenant_paywall','tenant_coupons','subscriptions'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3a. Broadcast trigger — CONFIG changed (tenant-scoped public channel).
--     Fires on any change to the tenant's paywall-affecting config so every SDK
--     bound to that tenant refetches /config immediately (kills the cache-TTL lag
--     that made a removed trial/discount linger in-app).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pc_broadcast_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
DECLARE
  v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
BEGIN
  IF v_tenant IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'event', 'config_changed',
      'tenant_id', v_tenant,
      'source', TG_TABLE_NAME,
      'op', TG_OP
    ),
    'config_changed',
    'config:' || v_tenant::text,
    false  -- public channel: payload is an invalidation ping only, never row data
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- ---------------------------------------------------------------------------
-- 3b. Broadcast trigger — ENTITLEMENT changed (per-user public channel).
--     Fires on the canonical reconciled entitlement so the buyer's SDK flips
--     premium/trial state live (purchase, cancel, trial start/end, restore).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pc_broadcast_entitlement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime
AS $$
DECLARE
  v_tenant uuid   := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_user   text   := COALESCE(NEW.app_user_id, OLD.app_user_id);
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'event', 'entitlement_changed',
      'tenant_id', v_tenant,
      'app_user_id', v_user,
      'op', TG_OP
    ),
    'entitlement_changed',
    'entitlement:' || v_tenant::text || ':' || v_user,
    false  -- public channel: invalidation ping only; SDK refetches via secure RPC
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Attach triggers (drop-then-create for idempotency).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_broadcast_config_products ON public.tenant_products;
CREATE TRIGGER trg_broadcast_config_products
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_products
  FOR EACH ROW EXECUTE FUNCTION public.pc_broadcast_config_change();

DROP TRIGGER IF EXISTS trg_broadcast_config_pricing ON public.tenant_pricing;
CREATE TRIGGER trg_broadcast_config_pricing
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_pricing
  FOR EACH ROW EXECUTE FUNCTION public.pc_broadcast_config_change();

DROP TRIGGER IF EXISTS trg_broadcast_config_paywall ON public.tenant_paywall;
CREATE TRIGGER trg_broadcast_config_paywall
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_paywall
  FOR EACH ROW EXECUTE FUNCTION public.pc_broadcast_config_change();

DROP TRIGGER IF EXISTS trg_broadcast_config_coupons ON public.tenant_coupons;
CREATE TRIGGER trg_broadcast_config_coupons
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_coupons
  FOR EACH ROW EXECUTE FUNCTION public.pc_broadcast_config_change();

DROP TRIGGER IF EXISTS trg_broadcast_entitlement ON public.entitlement_records;
CREATE TRIGGER trg_broadcast_entitlement
  AFTER INSERT OR UPDATE OR DELETE ON public.entitlement_records
  FOR EACH ROW EXECUTE FUNCTION public.pc_broadcast_entitlement_change();
