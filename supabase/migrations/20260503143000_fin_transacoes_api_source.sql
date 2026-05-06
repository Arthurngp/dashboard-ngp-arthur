alter table public.fin_transacoes
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_tag text,
  add column if not exists source_message text,
  add column if not exists api_token_id uuid references public.api_tokens(id) on delete set null;

create index if not exists fin_transacoes_source_type_idx
  on public.fin_transacoes (source_type);

create index if not exists fin_transacoes_api_token_idx
  on public.fin_transacoes (api_token_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fin_transacoes_source_type_check'
  ) then
    alter table public.fin_transacoes
      add constraint fin_transacoes_source_type_check
      check (source_type in ('manual', 'api', 'import', 'system'));
  end if;
end $$;
