alter table public.fin_transacoes
  add column if not exists assinatura_cliente_id uuid references public.fin_clientes(id) on delete set null,
  add column if not exists assinatura_referencia date;

create unique index if not exists fin_transacoes_assinatura_referencia_idx
  on public.fin_transacoes (assinatura_cliente_id, assinatura_referencia)
  where assinatura_cliente_id is not null and assinatura_referencia is not null;
