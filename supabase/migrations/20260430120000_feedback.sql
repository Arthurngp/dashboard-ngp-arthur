-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo: Feedback de usuários (bugs, erros, sugestões)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feedback (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Quem enviou
  usuario_id      uuid,
  usuario_nome    text,
  usuario_role    text,

  -- Conteúdo
  tipo            text        NOT NULL DEFAULT 'outro'
                              CHECK (tipo IN ('bug', 'erro', 'sugestao', 'duvida', 'outro')),
  mensagem        text        NOT NULL,

  -- Contexto técnico (capturado automaticamente)
  pagina_url      text,
  user_agent      text,

  -- Gestão pelo admin
  status          text        NOT NULL DEFAULT 'novo'
                              CHECK (status IN ('novo', 'em_andamento', 'resolvido', 'descartado')),
  resposta_admin  text
);

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.feedback_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_updated_at ON public.feedback;
CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.feedback_set_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_feedback_status     ON public.feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_tipo       ON public.feedback (tipo);
CREATE INDEX IF NOT EXISTS idx_feedback_usuario_id ON public.feedback (usuario_id);

-- RLS desabilitado — acesso via Edge Function com service role
ALTER TABLE public.feedback DISABLE ROW LEVEL SECURITY;
