-- Restringe acesso ao chat interno apenas a usuários com email @sejangp.com.br
-- Mudança: team_chat_is_internal_user() e team_chat_is_admin() ganham filtro de domínio
-- Razão: chat é exclusivo da equipe NGP — outros usuários do sistema (ex: clientes
-- com acesso ao portal, usuários legados) não devem ver nenhum canal.

CREATE OR REPLACE FUNCTION public.team_chat_is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = public.current_ngp_user_id()
      AND COALESCE(u.ativo, true) = true
      AND u.archived_at IS NULL
      AND u.role IN ('admin', 'ngp')
      AND lower(u.email) LIKE '%@sejangp.com.br'
  );
$$;

CREATE OR REPLACE FUNCTION public.team_chat_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = public.current_ngp_user_id()
      AND COALESCE(u.ativo, true) = true
      AND u.archived_at IS NULL
      AND u.role = 'admin'
      AND lower(u.email) LIKE '%@sejangp.com.br'
  );
$$;
