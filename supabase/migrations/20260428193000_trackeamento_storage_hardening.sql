-- ─────────────────────────────────────────────────────────────────────────────
-- Hardening do storage do módulo NGP Forms
-- Remove upload anônimo aberto e passa a exigir upload assinado via Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "trackeamento_form_assets_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "trackeamento_form_assets_public_read" ON storage.objects;

CREATE POLICY "trackeamento_form_assets_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'trackeamento-form-assets');
