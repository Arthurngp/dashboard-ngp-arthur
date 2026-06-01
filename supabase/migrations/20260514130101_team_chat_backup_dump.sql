-- RPC pra backup completo do chat. Apenas admins podem chamar.
-- Retorna JSON com todas as tabelas team_chat_*.
CREATE OR REPLACE FUNCTION public.team_chat_backup_dump()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.team_chat_is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem fazer dump completo';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'team_chat_channels', (
      SELECT coalesce(jsonb_agg(row_to_json(c.*)), '[]'::jsonb)
      FROM public.team_chat_channels c
    ),
    'team_chat_channel_members', (
      SELECT coalesce(jsonb_agg(row_to_json(m.*)), '[]'::jsonb)
      FROM public.team_chat_channel_members m
    ),
    'team_chat_messages', (
      SELECT coalesce(jsonb_agg(row_to_json(m.*)), '[]'::jsonb)
      FROM public.team_chat_messages m
    ),
    'team_chat_attachments', (
      SELECT coalesce(jsonb_agg(row_to_json(a.*)), '[]'::jsonb)
      FROM public.team_chat_attachments a
    ),
    'team_chat_reactions', (
      SELECT coalesce(jsonb_agg(row_to_json(r.*)), '[]'::jsonb)
      FROM public.team_chat_reactions r
    ),
    'team_chat_reads', (
      SELECT coalesce(jsonb_agg(row_to_json(r.*)), '[]'::jsonb)
      FROM public.team_chat_reads r
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_backup_dump() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_backup_dump() TO anon, authenticated, service_role;
