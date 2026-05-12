-- =============================================================================
-- Migration: Financeiro — pagamentos múltiplos por fatura (1:N)
-- Data: 2026-05-11
-- =============================================================================
--
-- ESCOPO
--
-- 1) Tabela fin_cartao_fatura_pagamentos: cada linha = um pagamento da fatura.
--    Permite pagamentos parciais ou múltiplas conciliações contra a mesma fatura.
--
-- 2) Trigger que recomputa fin_cartao_faturas.valor_pago e status
--    (aberta/parcial/paga) a partir do somatório de pagamentos.
--    Status 'parcial' é um valor novo do enum textual.
--
-- 3) Backfill: para faturas já com pagamento_tx_id setado, cria uma linha
--    correspondente em fin_cartao_fatura_pagamentos preservando paid_at,
--    paid_account_id, valor_pago.
-- =============================================================================

BEGIN;

-- ── status: aceitar 'parcial' (além de aberta/paga) ──────────────────────────
ALTER TABLE public.fin_cartao_faturas
  DROP CONSTRAINT IF EXISTS fin_cartao_faturas_status_check;
ALTER TABLE public.fin_cartao_faturas
  ADD CONSTRAINT fin_cartao_faturas_status_check
  CHECK (status IN ('aberta','parcial','paga'));

-- ── Tabela de pagamentos individuais ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fin_cartao_fatura_pagamentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id       UUID NOT NULL REFERENCES public.fin_cartao_faturas(id) ON DELETE CASCADE,
  transacao_id    UUID NULL REFERENCES public.fin_transacoes(id) ON DELETE SET NULL,
  account_id      UUID NULL REFERENCES public.fin_accounts(id) ON DELETE SET NULL,
  valor           NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  paid_at         DATE NOT NULL,
  observacoes     TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NULL
);

CREATE INDEX IF NOT EXISTS fin_cartao_fatura_pagamentos_fatura_idx
  ON public.fin_cartao_fatura_pagamentos (fatura_id);

CREATE INDEX IF NOT EXISTS fin_cartao_fatura_pagamentos_transacao_idx
  ON public.fin_cartao_fatura_pagamentos (transacao_id)
  WHERE transacao_id IS NOT NULL;

ALTER TABLE public.fin_cartao_fatura_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fin_cartao_fatura_pagamentos_service_role
  ON public.fin_cartao_fatura_pagamentos;
CREATE POLICY fin_cartao_fatura_pagamentos_service_role
  ON public.fin_cartao_fatura_pagamentos
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Função: recompõe valor_pago e status da fatura ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recalcular_fatura_pagamentos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fatura_id   UUID;
  v_total_pago  NUMERIC(14,2);
  v_valor_fat   NUMERIC(14,2);
  v_max_paid_at DATE;
  v_last_acc    UUID;
  v_last_tx     UUID;
  v_new_status  TEXT;
BEGIN
  v_fatura_id := COALESCE(NEW.fatura_id, OLD.fatura_id);

  SELECT COALESCE(SUM(valor), 0),
         MAX(paid_at)
    INTO v_total_pago, v_max_paid_at
    FROM public.fin_cartao_fatura_pagamentos
   WHERE fatura_id = v_fatura_id;

  SELECT valor INTO v_valor_fat
    FROM public.fin_cartao_faturas
   WHERE id = v_fatura_id;

  IF v_total_pago <= 0 THEN
    v_new_status := 'aberta';
  ELSIF v_valor_fat IS NOT NULL AND v_total_pago + 0.005 >= v_valor_fat THEN
    v_new_status := 'paga';
  ELSE
    v_new_status := 'parcial';
  END IF;

  -- Último pagamento define paid_account_id / pagamento_tx_id no header
  -- (compat com código antigo até o backend novo entrar).
  SELECT account_id, transacao_id
    INTO v_last_acc, v_last_tx
    FROM public.fin_cartao_fatura_pagamentos
   WHERE fatura_id = v_fatura_id
   ORDER BY paid_at DESC, created_at DESC
   LIMIT 1;

  UPDATE public.fin_cartao_faturas
     SET valor_pago      = v_total_pago,
         status          = v_new_status,
         paid_at         = CASE WHEN v_total_pago > 0 THEN v_max_paid_at::timestamptz ELSE NULL END,
         paid_account_id = CASE WHEN v_total_pago > 0 THEN v_last_acc ELSE NULL END,
         pagamento_tx_id = CASE WHEN v_total_pago > 0 THEN v_last_tx ELSE NULL END,
         updated_at      = now()
   WHERE id = v_fatura_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fatura_pagamentos_aiud
  ON public.fin_cartao_fatura_pagamentos;
CREATE TRIGGER trg_fatura_pagamentos_aiud
AFTER INSERT OR UPDATE OR DELETE
ON public.fin_cartao_fatura_pagamentos
FOR EACH ROW
EXECUTE FUNCTION public.fn_recalcular_fatura_pagamentos();

-- ── Backfill: transforma pagamento_tx_id pré-existente em linha da nova tabela
INSERT INTO public.fin_cartao_fatura_pagamentos
  (fatura_id, transacao_id, account_id, valor, paid_at, created_at)
SELECT
  f.id,
  f.pagamento_tx_id,
  f.paid_account_id,
  f.valor_pago,
  COALESCE(f.paid_at::date, CURRENT_DATE),
  COALESCE(f.updated_at, now())
FROM public.fin_cartao_faturas f
WHERE f.valor_pago > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.fin_cartao_fatura_pagamentos p
     WHERE p.fatura_id = f.id
  );

COMMIT;
