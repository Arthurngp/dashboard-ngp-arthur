create table if not exists public.fin_agent_runs (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id) on delete set null,
  intent text not null default 'briefing',
  message text,
  period_start date,
  period_end date,
  account_id uuid references public.fin_accounts(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  draft_actions jsonb not null default '[]'::jsonb,
  model text,
  status text not null default 'completed' check (status in ('completed', 'fallback', 'error')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists fin_agent_runs_created_at_idx
  on public.fin_agent_runs (created_at desc);

create index if not exists fin_agent_runs_usuario_created_idx
  on public.fin_agent_runs (usuario_id, created_at desc);

create index if not exists fin_agent_runs_account_created_idx
  on public.fin_agent_runs (account_id, created_at desc);
