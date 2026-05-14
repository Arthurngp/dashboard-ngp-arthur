-- Admin não burla canais privados. Privado = só membros, sempre.
-- Admin continua vendo:
--   - todos os canais 'client' (toda equipe interna vê)
--   - todos os canais 'general' públicos
--   - canais 'general' privados ONDE É MEMBRO

DROP POLICY IF EXISTS team_chat_channels_select ON public.team_chat_channels;
CREATE POLICY team_chat_channels_select
  ON public.team_chat_channels
  FOR SELECT
  USING (
    arquivado_em IS NULL
    AND (
      (type = 'client'  AND public.team_chat_is_internal_user())
      OR
      (type = 'general' AND is_private = false AND public.team_chat_is_internal_user())
      OR
      (type = 'general' AND is_private = true  AND public.team_chat_is_general_member(id))
    )
  );
