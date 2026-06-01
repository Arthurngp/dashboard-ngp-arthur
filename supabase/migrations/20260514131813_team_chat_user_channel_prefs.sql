-- Preferências de canal POR usuário: favoritar e ordenar.
CREATE TABLE IF NOT EXISTS public.team_chat_user_channel_prefs (
  channel_id   uuid NOT NULL REFERENCES public.team_chat_channels(id) ON DELETE CASCADE,
  usuario_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  is_favorite  boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS team_chat_user_prefs_user_idx
  ON public.team_chat_user_channel_prefs (usuario_id, is_favorite DESC, sort_order ASC);

ALTER TABLE public.team_chat_user_channel_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_chat_user_channel_prefs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_chat_user_prefs_select ON public.team_chat_user_channel_prefs;
CREATE POLICY team_chat_user_prefs_select
  ON public.team_chat_user_channel_prefs FOR SELECT
  USING (usuario_id = public.current_ngp_user_id());

DROP POLICY IF EXISTS team_chat_user_prefs_insert ON public.team_chat_user_channel_prefs;
CREATE POLICY team_chat_user_prefs_insert
  ON public.team_chat_user_channel_prefs FOR INSERT
  WITH CHECK (
    usuario_id = public.current_ngp_user_id()
    AND public.team_chat_can_access_channel(channel_id)
  );

DROP POLICY IF EXISTS team_chat_user_prefs_update ON public.team_chat_user_channel_prefs;
CREATE POLICY team_chat_user_prefs_update
  ON public.team_chat_user_channel_prefs FOR UPDATE
  USING (usuario_id = public.current_ngp_user_id())
  WITH CHECK (usuario_id = public.current_ngp_user_id());

DROP POLICY IF EXISTS team_chat_user_prefs_delete ON public.team_chat_user_channel_prefs;
CREATE POLICY team_chat_user_prefs_delete
  ON public.team_chat_user_channel_prefs FOR DELETE
  USING (usuario_id = public.current_ngp_user_id());

CREATE OR REPLACE FUNCTION public.team_chat_toggle_favorite(target_channel_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_id uuid; current_fav boolean; new_fav boolean;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.team_chat_can_access_channel(target_channel_id) THEN
    RAISE EXCEPTION 'Sem acesso ao canal';
  END IF;
  SELECT is_favorite INTO current_fav
  FROM public.team_chat_user_channel_prefs
  WHERE channel_id = target_channel_id AND usuario_id = caller_id;
  new_fav := NOT COALESCE(current_fav, false);
  INSERT INTO public.team_chat_user_channel_prefs (channel_id, usuario_id, is_favorite, updated_at)
  VALUES (target_channel_id, caller_id, new_fav, now())
  ON CONFLICT (channel_id, usuario_id)
    DO UPDATE SET is_favorite = EXCLUDED.is_favorite, updated_at = now();
  RETURN new_fav;
END; $$;
REVOKE ALL ON FUNCTION public.team_chat_toggle_favorite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_toggle_favorite(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_chat_set_sort_orders(channel_ids uuid[], orders int[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_id uuid; i int;
BEGIN
  caller_id := public.current_ngp_user_id();
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF array_length(channel_ids, 1) IS DISTINCT FROM array_length(orders, 1) THEN
    RAISE EXCEPTION 'Arrays de tamanho diferente';
  END IF;
  FOR i IN 1..array_length(channel_ids, 1) LOOP
    INSERT INTO public.team_chat_user_channel_prefs (channel_id, usuario_id, sort_order, updated_at)
    VALUES (channel_ids[i], caller_id, orders[i], now())
    ON CONFLICT (channel_id, usuario_id)
      DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = now();
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.team_chat_set_sort_orders(uuid[], int[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_chat_set_sort_orders(uuid[], int[]) TO anon, authenticated, service_role;
