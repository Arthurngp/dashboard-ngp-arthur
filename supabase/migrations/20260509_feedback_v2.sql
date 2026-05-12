-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback v2 — adiciona título, prioridade, screenshot e foto do usuário
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS titulo          text,
  ADD COLUMN IF NOT EXISTS prioridade      text NOT NULL DEFAULT 'media'
                                                CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
  ADD COLUMN IF NOT EXISTS screenshot_url  text,
  ADD COLUMN IF NOT EXISTS usuario_foto    text;

CREATE INDEX IF NOT EXISTS idx_feedback_prioridade ON public.feedback (prioridade);

-- Bucket para anexos de screenshots
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'feedback-screenshots') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('feedback-screenshots', 'feedback-screenshots', true);
  END IF;
END $$;
