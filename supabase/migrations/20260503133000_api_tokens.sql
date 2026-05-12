create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes jsonb not null default '[]'::jsonb,
  created_by uuid references public.usuarios(id) on delete set null,
  revoked_by uuid references public.usuarios(id) on delete set null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_tokens_prefix_idx
  on public.api_tokens (token_prefix);

create index if not exists api_tokens_active_idx
  on public.api_tokens (revoked_at, expires_at);

create table if not exists public.api_token_audit_logs (
  id uuid primary key default gen_random_uuid(),
  api_token_id uuid references public.api_tokens(id) on delete set null,
  action text not null,
  status text not null default 'success',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists api_token_audit_logs_created_idx
  on public.api_token_audit_logs (created_at desc);

create index if not exists api_token_audit_logs_token_created_idx
  on public.api_token_audit_logs (api_token_id, created_at desc);
