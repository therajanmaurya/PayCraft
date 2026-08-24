-- 077 — tenant_paywall trial-terms disclosure fields
--
-- Pairs with cmp-paycraft (paycraft-trial-terms-disclosure). Makes the paywall's
-- free-trial disclosure copy fully tenant-configurable from the dashboard so the
-- SDK renders Google Play Subscriptions-policy-compliant trial terms WITHOUT a
-- host rebuild:
--   • trial_terms_template   — per-plan line naming the post-trial price + cadence
--   • trial_disclosure_title — the disclosure block heading
--   • trial_disclosure_body  — the auto-renew + how-to-cancel legal line
--
-- Why this exists: reels-downloader (version code 33) was REJECTED under the
-- Subscriptions policy ("Terms of trial offer or introductory pricing are unclear")
-- because the paywall advertised "14-day free trial" without stating the post-trial
-- price, when billing starts, or how to cancel. These fields carry that copy.
--
-- Substitution tokens the SDK replaces at render (NOT SQL — passed through verbatim):
--   {days}  → trial length in days
--   {price} → formatted "price / interval" e.g. "₹299 / month"
--
-- Defaults exactly match the SDK's strings.xml fallbacks (paycraft_trial_plan_terms /
-- paycraft_trial_disclosure_title / paycraft_trial_disclosure_body) so a tenant that
-- never opens the designer still ships a compliant disclosure.
--
-- All ADD COLUMN statements use IF NOT EXISTS for idempotent re-apply on supabase db
-- reset. tenant_paywall_upsert is replaced (CREATE OR REPLACE) with a signature that
-- also handles the three new fields; backward-compatible with older payloads (missing
-- fields fall through to the column defaults via COALESCE).

-- ── 1. The 3 trial-disclosure columns ───────────────────────────────────
ALTER TABLE public.tenant_paywall
  ADD COLUMN IF NOT EXISTS trial_terms_template   TEXT NOT NULL DEFAULT '{days}-day free trial, then {price}',
  ADD COLUMN IF NOT EXISTS trial_disclosure_title TEXT NOT NULL DEFAULT '{days}-day free trial included',
  ADD COLUMN IF NOT EXISTS trial_disclosure_body  TEXT NOT NULL DEFAULT 'Your free trial converts to a paid subscription automatically when it ends. Cancel anytime before then in your store subscription settings to avoid being charged.';

COMMENT ON COLUMN public.tenant_paywall.trial_terms_template IS
  'Per-plan trial-terms line rendered under a trial-eligible plan card. Tokens {days}/{price} substituted by the SDK. Play Subscriptions-policy disclosure: names the post-trial price + cadence on the offer itself.';
COMMENT ON COLUMN public.tenant_paywall.trial_disclosure_title IS
  'Trial disclosure block heading (token {days} substituted by the SDK).';
COMMENT ON COLUMN public.tenant_paywall.trial_disclosure_body IS
  'Trial disclosure block body — the auto-renew + how-to-cancel legal line (Play Subscriptions policy).';

-- ── 2. tenant_paywall_upsert — handle the 3 new fields ──────────────────
-- Replaces migration 071's v2 RPC. Backward-compatible: payloads missing the trial
-- fields fall through to column defaults via COALESCE. Every other field is carried
-- over unchanged from 071.
CREATE OR REPLACE FUNCTION public.tenant_paywall_upsert(p_row JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := (p_row->>'tenant_id')::UUID;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_id required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO tenant_paywall (
    -- v1 (migration 030)
    tenant_id, template, theme_jsonb, branding, custom_footer,
    primary_color, font_family, support_email,
    -- v2 (migration 071)
    hero_title, hero_subtitle, value_props,
    cta_continue, cta_get_premium, restore_label,
    terms_url, privacy_url, popular_plan_sku,
    success_title, success_message, success_cta_label,
    hero_icon_svg, hero_icon_url,
    -- trial disclosure (migration 077)
    trial_terms_template, trial_disclosure_title, trial_disclosure_body,
    updated_at
  )
  VALUES (
    v_tenant,
    COALESCE(p_row->>'template', 'branded-stack')::paywall_template,
    COALESCE(p_row->'theme_jsonb', '{}'::jsonb),
    COALESCE(p_row->>'branding', 'attribution')::branding_mode,
    p_row->>'custom_footer',
    p_row->>'primary_color',
    p_row->>'font_family',
    p_row->>'support_email',
    COALESCE(p_row->>'hero_title', 'Upgrade to Premium'),
    COALESCE(p_row->>'hero_subtitle', 'Enjoy ad-free experience, HD downloads, and exclusive features'),
    COALESCE(p_row->'value_props', '[]'::jsonb),
    COALESCE(p_row->>'cta_continue', 'Continue'),
    COALESCE(p_row->>'cta_get_premium', 'Get Premium'),
    COALESCE(p_row->>'restore_label', 'Restore Your Premium'),
    p_row->>'terms_url',
    p_row->>'privacy_url',
    p_row->>'popular_plan_sku',
    COALESCE(p_row->>'success_title', 'Welcome to Premium!'),
    COALESCE(p_row->>'success_message', 'You now have access to all premium features.'),
    COALESCE(p_row->>'success_cta_label', 'Continue to app'),
    sanitize_paywall_svg(p_row->>'hero_icon_svg'),
    p_row->>'hero_icon_url',
    COALESCE(p_row->>'trial_terms_template', '{days}-day free trial, then {price}'),
    COALESCE(p_row->>'trial_disclosure_title', '{days}-day free trial included'),
    COALESCE(p_row->>'trial_disclosure_body', 'Your free trial converts to a paid subscription automatically when it ends. Cancel anytime before then in your store subscription settings to avoid being charged.'),
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    template          = EXCLUDED.template,
    theme_jsonb       = EXCLUDED.theme_jsonb,
    branding          = EXCLUDED.branding,
    custom_footer     = EXCLUDED.custom_footer,
    primary_color     = EXCLUDED.primary_color,
    font_family       = EXCLUDED.font_family,
    support_email     = EXCLUDED.support_email,
    hero_title        = EXCLUDED.hero_title,
    hero_subtitle     = EXCLUDED.hero_subtitle,
    value_props       = EXCLUDED.value_props,
    cta_continue      = EXCLUDED.cta_continue,
    cta_get_premium   = EXCLUDED.cta_get_premium,
    restore_label     = EXCLUDED.restore_label,
    terms_url         = EXCLUDED.terms_url,
    privacy_url       = EXCLUDED.privacy_url,
    popular_plan_sku  = EXCLUDED.popular_plan_sku,
    success_title     = EXCLUDED.success_title,
    success_message   = EXCLUDED.success_message,
    success_cta_label = EXCLUDED.success_cta_label,
    hero_icon_svg     = EXCLUDED.hero_icon_svg,
    hero_icon_url     = EXCLUDED.hero_icon_url,
    trial_terms_template   = EXCLUDED.trial_terms_template,
    trial_disclosure_title = EXCLUDED.trial_disclosure_title,
    trial_disclosure_body  = EXCLUDED.trial_disclosure_body,
    updated_at        = now();
END;
$$;

COMMENT ON FUNCTION public.tenant_paywall_upsert(JSONB) IS
  'Idempotent upsert for tenant_paywall. migration 077 — adds trial_terms_template / trial_disclosure_title / trial_disclosure_body on top of the 071 v2 fields.';

GRANT EXECUTE ON FUNCTION public.tenant_paywall_upsert(JSONB) TO authenticated;
