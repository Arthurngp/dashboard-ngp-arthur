-- ============================================================================
-- Módulo: NGP Copilot — Anexos com extração de inteligência por tipo
-- Escopo: campaign_assets
-- Decisão de produto: cada tipo de anexo gera uma extração específica que
-- vira contexto pra IA (PRD seção 8.5 + ajustes do Arthur):
--   - HTML/PDF planejamento -> texto + estrutura (objetivos, KPIs, budget)
--   - Imagem/foto/carrossel -> Vision (copy na arte, hierarquia, CTA)
--   - Vídeo -> Whisper+Vision (fase 2, marcamos como 'video_criativo' já)
--   - Transcript reunião -> texto puro + sumarização
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid,
  client_id           uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,

  -- Liga ao chat onde o anexo entrou (opcional — pode entrar via UI direta)
  conversation_id     uuid REFERENCES public.copilot_conversations(id) ON DELETE SET NULL,
  message_id          uuid REFERENCES public.copilot_messages(id) ON DELETE SET NULL,
  attachment_id       uuid REFERENCES public.copilot_attachments(id) ON DELETE SET NULL,

  asset_type          text NOT NULL CHECK (asset_type IN (
                        'planejamento_html',
                        'planejamento_pdf',
                        'imagem_criativa',
                        'carrossel',
                        'video_criativo',
                        'transcript_reuniao',
                        'outro'
                      )),
  label               text,

  storage_provider    text NOT NULL DEFAULT 'supabase'
                      CHECK (storage_provider IN ('supabase', 'external_link')),
  storage_path        text,
  external_url        text,
  mime_type           text,
  file_size_bytes     bigint,

  -- Resultado da extração assíncrona
  extraction_status   text NOT NULL DEFAULT 'pending'
                      CHECK (extraction_status IN ('pending','processing','done','failed','skipped')),
  extraction_error    text,
  extracted_text      text,                      -- texto bruto (OCR, PDF, transcript)
  extracted_summary   text,                      -- resumo gerado pela IA
  extracted_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- campos por tipo
  extraction_model    text,
  extracted_at        timestamptz,

  -- Métricas / performance observada (preenchidas depois pra fechar o loop)
  performance_notes   text,

  created_by_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Pelo menos um dos dois caminhos de storage
  CONSTRAINT campaign_assets_storage_present CHECK (
    storage_path IS NOT NULL OR external_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS campaign_assets_client_created_idx
  ON public.campaign_assets (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_assets_client_type_idx
  ON public.campaign_assets (client_id, asset_type, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_assets_extraction_status_idx
  ON public.campaign_assets (extraction_status, created_at)
  WHERE extraction_status IN ('pending','processing','failed');

CREATE INDEX IF NOT EXISTS campaign_assets_conversation_idx
  ON public.campaign_assets (conversation_id);

-- Full-text PT-BR no texto extraído + resumo
CREATE INDEX IF NOT EXISTS campaign_assets_fts_idx
  ON public.campaign_assets
  USING GIN (
    to_tsvector('portuguese',
      coalesce(label, '') || ' ' ||
      coalesce(extracted_summary, '') || ' ' ||
      coalesce(extracted_text, '')
    )
  );

DROP TRIGGER IF EXISTS campaign_assets_updated_at ON public.campaign_assets;
CREATE TRIGGER campaign_assets_updated_at
  BEFORE UPDATE ON public.campaign_assets
  FOR EACH ROW EXECUTE FUNCTION public.copilot_set_updated_at();

ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_campaign_assets" ON public.campaign_assets;
CREATE POLICY "ngp_all_campaign_assets"
  ON public.campaign_assets FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

COMMIT;
