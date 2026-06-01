-- Full-text search PT-BR no histórico de mensagens do Copilot por cliente.
-- Retorna trechos relevantes da conversa pra ser injetados como camada 5
-- de contexto. Usado pela edge function copilot-chat.

CREATE OR REPLACE FUNCTION public.copilot_search_history(
  p_client_id uuid,
  p_query text,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  message_id uuid,
  role text,
  created_at timestamptz,
  snippet text,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid;
BEGIN
  v_caller := public.current_ngp_user_id();
  IF v_caller IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Sem sessão NGP';
  END IF;

  RETURN QUERY
  WITH q AS (SELECT plainto_tsquery('portuguese', p_query) AS tsq)
  SELECT
    m.id,
    m.role,
    m.created_at,
    ts_headline('portuguese', m.texto, q.tsq,
      'StartSel=«, StopSel=», MaxFragments=2, MaxWords=20, MinWords=5'
    ) AS snippet,
    ts_rank(to_tsvector('portuguese', coalesce(m.texto, '')), q.tsq) AS rank
  FROM copilot_messages m, q
  WHERE m.client_id = p_client_id
    AND m.deleted_at IS NULL
    AND to_tsvector('portuguese', coalesce(m.texto, '')) @@ q.tsq
  ORDER BY rank DESC, m.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.copilot_search_history(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copilot_search_history(uuid, text, integer) TO service_role;
