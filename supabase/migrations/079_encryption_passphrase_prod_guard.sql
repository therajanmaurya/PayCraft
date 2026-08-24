-- Migration 079 — refuse the dev-default encryption passphrase.
--
-- Migration 055 seeds paycraft_secrets_config.passphrase with a KNOWN,
-- committed dev value ('paycraft-local-dev-passphrase-CHANGE-IN-PROD') via
-- `ON CONFLICT DO NOTHING`. On 2026-08-23 prod was found still using it, so
-- every stored provider secret was encrypted with a public passphrase. Prod has
-- since been rotated to the strong `paycraft-encryption-key`; this migration
-- prevents the class of issue from ever recurring on a FRESH environment.
--
-- `encrypt_provider_key` now RAISES if the passphrase is empty OR the dev
-- default — so a brand-new deployment (which seeds the dev default) CANNOT
-- store any provider secret until an operator rotates the passphrase to a real
-- value. Prod is unaffected (its passphrase is the vault key, not the default).
-- Idempotent: pure CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.encrypt_provider_key(p_key TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase TEXT;
BEGIN
  SELECT passphrase INTO v_passphrase FROM public.paycraft_secrets_config WHERE id = TRUE;
  IF v_passphrase IS NULL OR v_passphrase = '' THEN
    RAISE EXCEPTION 'paycraft_secrets_config.passphrase is empty. Seed it with a strong secret before saving provider secrets.';
  END IF;
  IF v_passphrase = 'paycraft-local-dev-passphrase-CHANGE-IN-PROD' THEN
    RAISE EXCEPTION 'Refusing to encrypt with the dev-default passphrase. Rotate public.paycraft_secrets_config.passphrase to the strong paycraft-encryption-key before storing any provider secret (see memory paycraft-provider-key-storage-encryption).';
  END IF;
  RETURN pgp_sym_encrypt(p_key, v_passphrase);
END;
$$;

-- Deploy/CI helper — returns TRUE when prod is still on the insecure default.
-- Wire into the deploy gate: SELECT public.paycraft_encryption_passphrase_is_default();
CREATE OR REPLACE FUNCTION public.paycraft_encryption_passphrase_is_default()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT passphrase = 'paycraft-local-dev-passphrase-CHANGE-IN-PROD'
     FROM public.paycraft_secrets_config WHERE id = TRUE),
    TRUE
  );
$$;

COMMENT ON FUNCTION public.paycraft_encryption_passphrase_is_default() IS
  'TRUE if provider-secret encryption is still using the committed dev-default passphrase. Prod must be FALSE.';
