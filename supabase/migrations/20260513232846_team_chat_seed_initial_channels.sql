-- Seed inicial do chat interno NGP.
-- Idempotente: pode rodar múltiplas vezes sem duplicar.
-- 1) Cria canal #geral
-- 2) Adiciona todos os usuários @sejangp.com.br ativos (admin = role 'admin', resto = 'member')
-- 3) Cria 1 canal por cliente ativo (não precisa de membership: RLS libera para internal_user)

INSERT INTO public.team_chat_channels (type, nome, slug, descricao)
SELECT 'general', 'Geral', 'geral', 'Canal aberto a toda equipe NGP (@sejangp.com.br)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.team_chat_channels
  WHERE type='general' AND slug='geral'
);

INSERT INTO public.team_chat_channel_members (channel_id, usuario_id, role)
SELECT
  c.id,
  u.id,
  CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END
FROM public.team_chat_channels c
CROSS JOIN public.usuarios u
WHERE c.type='general' AND c.slug='geral'
  AND COALESCE(u.ativo, true) = true
  AND u.archived_at IS NULL
  AND u.role IN ('admin','ngp')
  AND lower(u.email) LIKE '%@sejangp.com.br'
ON CONFLICT (channel_id, usuario_id) DO NOTHING;

INSERT INTO public.team_chat_channels (type, nome, cliente_id, descricao)
SELECT
  'client',
  cl.nome,
  cl.id,
  'Canal dedicado ao cliente ' || cl.nome
FROM public.clientes cl
WHERE COALESCE(cl.ativo, true) = true
ON CONFLICT (cliente_id) WHERE type='client' DO NOTHING;
