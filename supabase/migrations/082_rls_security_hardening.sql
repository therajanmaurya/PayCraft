-- 082_rls_security_hardening.sql
-- PRODUCTION SECURITY REMEDIATION — closes LIVE cross-tenant data-exposure paths.
--
-- Findings (prod-readiness audit, 2026-08-24):
--   * `subscriptions` still carries a `Public read USING (true)` policy on PROD
--     (the drop intended by migration 012 never took effect on the live DB), so
--     any anon-key holder can read every buyer's email/status/trial across every
--     tenant. Direct exploit confirmed: anon SELECT returns rows.
--   * The 5 analytics VIEWS + 3 materialized views run with owner privileges
--     (no security_invoker) and are anon-SELECTable → cross-tenant MRR / revenue
--     / churn / subscriber counts leak via PostgREST.
--   * `tenant_rate_limits` has RLS disabled → anon-reachable via PostgREST.
--
-- Strategy: add tenant-admin-scoped SELECT policies to the base tables the
-- dashboard reads (it uses the anon key + the admin's JWT), THEN drop the public
-- policy and flip the views to security_invoker so they respect that RLS. The SDK
-- is unaffected — it reads these tables only through SECURITY DEFINER RPCs, and
-- webhook writers use the service role (both bypass RLS).
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE; ALTER/REVOKE are re-runnable.

-- 1. subscriptions — tenant-admin SELECT, then drop the anon-readable public policy.
DROP POLICY IF EXISTS subscriptions_tenant_admin_select ON public.subscriptions;
CREATE POLICY subscriptions_tenant_admin_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
DROP POLICY IF EXISTS "Public read subscriptions" ON public.subscriptions;

-- 2. webhook_logs — tenant-admin SELECT (needed for tenant_webhook_delivery_view
--    under security_invoker). Writers use the service role.
DROP POLICY IF EXISTS webhook_logs_tenant_admin_select ON public.webhook_logs;
CREATE POLICY webhook_logs_tenant_admin_select ON public.webhook_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));

-- 3. Analytics VIEWS — run as the invoking user so RLS above scopes them per tenant,
--    and revoke anon so unauthenticated PostgREST calls are denied outright.
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'tenant_mrr_view','tenant_subscriber_count_view','tenant_churn_view',
    'tenant_revenue_by_plan_view','tenant_webhook_delivery_view'
  ] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
  END LOOP;
END $$;

-- 4. Materialized views cannot use security_invoker/RLS — revoke all client access
--    (the dashboard does not read them directly; expose via a tenant-scoped RPC if
--    ever needed).
REVOKE ALL ON public.mv_tenant_mrr        FROM anon, authenticated;
REVOKE ALL ON public.mv_subscriber_cohorts FROM anon, authenticated;
REVOKE ALL ON public.mv_churn_by_month    FROM anon, authenticated;

-- 5. tenant_rate_limits — enable RLS (anon/other-tenant get zero rows) + a
--    tenant-admin SELECT for the dashboard usage view. The rate_limit_check RPC
--    (SECURITY DEFINER) does the writes and bypasses RLS.
ALTER TABLE public.tenant_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rate_limits_tenant_admin_select ON public.tenant_rate_limits;
CREATE POLICY tenant_rate_limits_tenant_admin_select ON public.tenant_rate_limits
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
