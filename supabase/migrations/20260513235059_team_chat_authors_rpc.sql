-- RPC para buscar perfis básicos de autores do chat (nome + foto).
-- Necessário porque o cliente Supabase usa anon role com x-session-token,
-- e as RLS atuais de public.usuarios só permitem roles 'authenticated'/'service_role'.
-- A função roda SECURITY DEFINER mas só responde se o caller for usuário interno do chat.

CREATE OR REPLACE FUNCTION public.team_chat_get_authors(user_ids uuid[])
RETURNS TABLE (id uuid, nome text, foto_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.team_chat_is_internal_user() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT u.id, u.nome, COALESCE(u.foto_url, u.foto) AS foto_url
    FROM public.usuarios u
    WHERE u.id = ANY(user_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_get_authors(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_get_authors(uuid[]) TO anon, authenticated, service_role;
