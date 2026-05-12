-- =============================================================================
-- Migration: jornada de trabalho por colaborador
-- Data: 2026-05-12
-- =============================================================================
--
-- ESCOPO
--
-- Tabela 1:1 com `usuarios` que define a carga prevista em minutos por dia
-- da semana. Cada coluna min_<dia> = minutos esperados naquele dia
-- (0 = folga / sem expediente).
--
-- Quando não houver linha aqui, o frontend aplica a regra NGP padrão:
-- seg-qui 540 (9h), sex 480 (8h), sáb/dom 0.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.usuario_jornada (
  usuario_id UUID PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  min_dom INT NOT NULL DEFAULT 0   CHECK (min_dom BETWEEN 0 AND 1440),
  min_seg INT NOT NULL DEFAULT 540 CHECK (min_seg BETWEEN 0 AND 1440),
  min_ter INT NOT NULL DEFAULT 540 CHECK (min_ter BETWEEN 0 AND 1440),
  min_qua INT NOT NULL DEFAULT 540 CHECK (min_qua BETWEEN 0 AND 1440),
  min_qui INT NOT NULL DEFAULT 540 CHECK (min_qui BETWEEN 0 AND 1440),
  min_sex INT NOT NULL DEFAULT 480 CHECK (min_sex BETWEEN 0 AND 1440),
  min_sab INT NOT NULL DEFAULT 0   CHECK (min_sab BETWEEN 0 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usuario_jornada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_jornada_service_role ON public.usuario_jornada;
CREATE POLICY usuario_jornada_service_role
  ON public.usuario_jornada
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
