alter table public.fin_clientes
  add column if not exists mensalidade_valor numeric(12,2),
  add column if not exists mensalidade_descricao text,
  add column if not exists dia_cobranca integer,
  add column if not exists assinatura_ativa boolean not null default false;

update public.fin_clientes
set assinatura_ativa = false
where assinatura_ativa is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fin_clientes_dia_cobranca_check'
  ) then
    alter table public.fin_clientes
      add constraint fin_clientes_dia_cobranca_check
      check (dia_cobranca is null or (dia_cobranca between 1 and 31));
  end if;
end $$;
