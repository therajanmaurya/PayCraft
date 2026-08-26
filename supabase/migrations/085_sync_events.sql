-- 085_sync_events.sql
-- Per-event product-sync progress stream, for the dashboard's live "syncing…"
-- dialog. runProductSync emits one row per (product × provider) start + result;
-- the dashboard subscribes over Supabase Realtime (filtered by run_id) and renders
-- a human-readable, per-provider progress log. Ephemeral evidence — pruned on a
-- rolling window; the durable state stays on tenant_products.sync_state.

CREATE TABLE IF NOT EXISTS public.sync_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       UUID NOT NULL,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id   UUID,
  product_name TEXT,
  provider     TEXT,
  phase        TEXT NOT NULL,          -- start | ok | skipped | failed | run_done
  status       TEXT,                   -- synced | draft | skipped | failed
  message      TEXT NOT NULL,          -- human-readable, e.g. "Creating Stripe price for Pro Annual…"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_events_run ON public.sync_events (run_id, id);
CREATE INDEX IF NOT EXISTS idx_sync_events_tenant_time ON public.sync_events (tenant_id, created_at);

-- RLS: the dashboard admin reads its own tenant's events; writers use the service role.
ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_events_tenant_admin_select ON public.sync_events;
CREATE POLICY sync_events_tenant_admin_select ON public.sync_events
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
DROP POLICY IF EXISTS sync_events_service_all ON public.sync_events;
CREATE POLICY sync_events_service_all ON public.sync_events
  FOR ALL TO public
  USING (current_setting('role') = 'service_role')
  WITH CHECK (current_setting('role') = 'service_role');

-- Realtime: publish + full replica identity so the run_id filter works.
ALTER TABLE public.sync_events REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sync_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_events';
  END IF;
END $$;

-- Emit one event (service-role/backend helper; SECURITY DEFINER so the sync code
-- can log via a single RPC without direct table grants).
-- Callable by an authenticated tenant-admin (own tenant only — same guard as the
-- product/pricing RPCs) so the sync route can log as the user, AND by the trusted
-- backend (auth.uid() null → service-role onboarding/setup).
CREATE OR REPLACE FUNCTION public.sync_event_emit(
  p_run_id UUID, p_tenant_id UUID, p_product_id UUID, p_product_name TEXT,
  p_provider TEXT, p_phase TEXT, p_status TEXT, p_message TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.sync_events(run_id, tenant_id, product_id, product_name, provider, phase, status, message)
  VALUES (p_run_id, p_tenant_id, p_product_id, p_product_name, p_provider, p_phase, p_status, p_message);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_emit(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_event_emit(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role;
