alter table public.fin_accounts
  add column if not exists ativo boolean;

update public.fin_accounts
set ativo = true
where ativo is null;

alter table public.fin_accounts
  alter column ativo set default true;
