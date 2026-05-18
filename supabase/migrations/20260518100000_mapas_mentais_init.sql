-- ============================================================================
-- Módulo: Mapas Mentais (setor de Brainstorm)
-- PRD: docs/mapa-mental-prd.md (Fase 1)
-- Escopo: cabeçalho do mapa + nós em árvore (parent_id no próprio nó)
-- Auth: equipe interna NGP — RLS via sessions + usuarios.role
--
-- Decisões:
--   - Árvore via parent_id (sem tabela de edges). Query simples e sem aresta órfã.
--   - unique partial: cada mapa tem exatamente 1 nó raiz (parent_id IS NULL).
--   - ON DELETE CASCADE encadeado: deletar nó pai apaga subárvore.
--   - Posições x/y são opcionais (auto-layout cuida quando NULL).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. mapas_mentais (cabeçalho)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mapas_mentais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  titulo      text NOT NULL,
  descricao   text,
  tags        text[] NOT NULL DEFAULT '{}',
  auto_layout boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mapas_mentais_cliente_idx
  ON public.mapas_mentais (cliente_id);

CREATE INDEX IF NOT EXISTS mapas_mentais_updated_idx
  ON public.mapas_mentais (updated_at DESC);

-- ----------------------------------------------------------------------------
-- 2. mapas_mentais_nos
--    parent_id IS NULL → nó raiz do mapa (apenas 1 por mapa).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mapas_mentais_nos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapa_id    uuid NOT NULL REFERENCES public.mapas_mentais(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES public.mapas_mentais_nos(id) ON DELETE CASCADE,
  texto      text NOT NULL DEFAULT '',
  nota_md    text,
  cor        text,
  icone      text,
  posicao_x  double precision,
  posicao_y  double precision,
  ordem      integer NOT NULL DEFAULT 0,
  collapsed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mapas_mentais_nos_mapa_idx
  ON public.mapas_mentais_nos (mapa_id);

CREATE INDEX IF NOT EXISTS mapas_mentais_nos_parent_idx
  ON public.mapas_mentais_nos (parent_id);

-- Exatamente um nó raiz por mapa
CREATE UNIQUE INDEX IF NOT EXISTS mapas_mentais_nos_uniq_raiz
  ON public.mapas_mentais_nos (mapa_id)
  WHERE parent_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Triggers de updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mapas_mentais_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mapas_mentais_updated_at ON public.mapas_mentais;
CREATE TRIGGER mapas_mentais_updated_at
  BEFORE UPDATE ON public.mapas_mentais
  FOR EACH ROW EXECUTE FUNCTION public.mapas_mentais_set_updated_at();

DROP TRIGGER IF EXISTS mapas_mentais_nos_updated_at ON public.mapas_mentais_nos;
CREATE TRIGGER mapas_mentais_nos_updated_at
  BEFORE UPDATE ON public.mapas_mentais_nos
  FOR EACH ROW EXECUTE FUNCTION public.mapas_mentais_set_updated_at();

-- Quando um nó muda, marcar o mapa pai como atualizado (pra listagem ordenar bem)
CREATE OR REPLACE FUNCTION public.mapas_mentais_touch_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.mapas_mentais
     SET updated_at = now()
   WHERE id = COALESCE(NEW.mapa_id, OLD.mapa_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS mapas_mentais_nos_touch_mapa ON public.mapas_mentais_nos;
CREATE TRIGGER mapas_mentais_nos_touch_mapa
  AFTER INSERT OR UPDATE OR DELETE ON public.mapas_mentais_nos
  FOR EACH ROW EXECUTE FUNCTION public.mapas_mentais_touch_parent();

-- ----------------------------------------------------------------------------
-- 4. RLS — toda equipe interna NGP (admin/ngp) lê e escreve
--    service_role bypassa pra jobs futuros.
-- ----------------------------------------------------------------------------
ALTER TABLE public.mapas_mentais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapas_mentais FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mapas_mentais_nos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapas_mentais_nos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ngp_all_mapas_mentais" ON public.mapas_mentais;
CREATE POLICY "ngp_all_mapas_mentais"
  ON public.mapas_mentais
  FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

DROP POLICY IF EXISTS "ngp_all_mapas_mentais_nos" ON public.mapas_mentais_nos;
CREATE POLICY "ngp_all_mapas_mentais_nos"
  ON public.mapas_mentais_nos
  FOR ALL
  USING (public.current_ngp_user_id() IS NOT NULL)
  WITH CHECK (public.current_ngp_user_id() IS NOT NULL);

COMMENT ON TABLE public.mapas_mentais IS
  'Mapas mentais (setor de Brainstorm). Cabeçalho do mapa. PRD: docs/mapa-mental-prd.md';
COMMENT ON TABLE public.mapas_mentais_nos IS
  'Nós de um mapa mental. Árvore via parent_id (sem tabela de edges).';

COMMIT;
