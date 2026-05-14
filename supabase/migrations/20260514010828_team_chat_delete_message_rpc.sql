-- RPC pra soft-delete de mensagem que contorna o problema de RLS + UPDATE + RETURNING.
-- Valida internamente que o caller é o autor e usa SECURITY DEFINER pra fazer o UPDATE.
CREATE OR REPLACE FUNCTION public.team_chat_delete_message(target_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  msg_autor uuid;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT autor_usuario_id INTO msg_autor
  FROM public.team_chat_messages
  WHERE id = target_message_id;

  IF msg_autor IS NULL THEN
    RAISE EXCEPTION 'Mensagem não encontrada';
  END IF;

  IF msg_autor <> caller_id THEN
    RAISE EXCEPTION 'Sem permissão para apagar';
  END IF;

  UPDATE public.team_chat_messages
  SET deleted_at = now(), updated_at = now()
  WHERE id = target_message_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.team_chat_delete_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_delete_message(uuid) TO anon, authenticated, service_role;
