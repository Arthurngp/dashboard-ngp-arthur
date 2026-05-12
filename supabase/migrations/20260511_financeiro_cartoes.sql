-- =============================================================================
-- Migration: Financeiro — parcelas em cartão + tabela de faturas
-- Data: 2026-05-11
-- =============================================================================
--
-- ESCOPO
--
-- 1) Colunas installment_* em fin_transacoes para suportar parcelamento de
--    despesas (cartão de crédito). Linhas parceladas compartilham o mesmo
--    installment_group_id; cada linha tem installment_index (1..N) e
--    installment_total (N).
--
-- 2) Tabela fin_cartao_faturas: status (aberta/paga) de cada fatura
--    (cartao_id + mes_ref). Permite "Ver faturas" mostrar Pagas/Em aberto.
-- =============================================================================

BEGIN;

ALTER TABLE public.fin_transacoes
  ADD COLUMN IF NOT EXISTS installment_group_id UUID NULL,
  ADD COLUMN IF NOT EXISTS installment_index    INT  NULL,
  ADD COLUMN IF NOT EXISTS installment_total    INT  NULL;

ALTER TABLE public.fin_transacoes
  DROP CONSTRAINT IF EXISTS fin_transacoes_installment_consistency_check;
ALTER TABLE public.fin_transacoes
  ADD CONSTRAINT fin_transacoes_installment_consistency_check
  CHECK (
    (installment_group_id IS NULL AND installment_index IS NULL AND installment_total IS NULL)
    OR
    (
      installment_group_id IS NOT NULL
      AND installment_index IS NOT NULL AND installment_index >= 1
      AND installment_total IS NOT NULL AND installment_total >= 1
      AND installment_index <= installment_total
    )
  );

CREATE INDEX IF NOT EXISTS fin_transacoes_installment_group_idx
  ON public.fin_transacoes (installment_group_id)
  WHERE installment_group_id IS NOT NULL;

-- Recria VIEW para incluir novas colunas (SELECT *).
CREATE OR REPLACE VIEW public.fin_transacoes_ativas AS
SELECT *
FROM public.fin_transacoes
WHERE deleted_at IS NULL;

-- ── Tabela de faturas dos cartões ─────────────────────────────────────────────
-- mes_ref é o primeiro dia do mês de referência da fatura (ex: 2026-05-01).
CREATE TABLE IF NOT EXISTS public.fin_cartao_faturas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cartao_id       UUID NOT NULL REFERENCES public.fin_accounts(id) ON DELETE CASCADE,
  mes_ref         DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga')),
  valor           NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_pago      NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_at         TIMESTAMPTZ NULL,
  paid_account_id UUID NULL REFERENCES public.fin_accounts(id) ON DELETE SET NULL,
  pagamento_tx_id UUID NULL REFERENCES public.fin_transacoes(id) ON DELETE SET NULL,
  observacoes     TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cartao_id, mes_ref)
);

CREATE INDEX IF NOT EXISTS fin_cartao_faturas_cartao_mes_idx
  ON public.fin_cartao_faturas (cartao_id, mes_ref);

ALTER TABLE public.fin_cartao_faturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fin_cartao_faturas_service_role ON public.fin_cartao_faturas;
CREATE POLICY fin_cartao_faturas_service_role
  ON public.fin_cartao_faturas
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
