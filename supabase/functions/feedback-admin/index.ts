import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from '../_shared/cors.ts';

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const obj = e as Record<string, unknown>;
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e));
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { session_token, action, feedback_id, status, resposta_admin } = await req.json();

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);

    const SURL    = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb      = createClient(SURL, SERVICE);

    // Valida sessão e role admin
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401);

    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single();

    if (!usuario || usuario.role !== 'admin') {
      return json(req, { error: 'Acesso negado.' }, 403);
    }

    // Listar feedbacks
    if (action === 'list' || !action) {
      const { data, error } = await sb
        .from('feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) return json(req, { error: errMsg(error) }, 500);
      return json(req, { feedbacks: data });
    }

    // Atualizar status / resposta
    if (action === 'update') {
      if (!feedback_id) return json(req, { error: 'feedback_id obrigatório.' }, 400);

      const update: Record<string, unknown> = {};
      if (status) update.status = status;
      if (resposta_admin !== undefined) update.resposta_admin = resposta_admin;

      const { error } = await sb
        .from('feedback')
        .update(update)
        .eq('id', feedback_id);

      if (error) return json(req, { error: errMsg(error) }, 500);
      return json(req, { ok: true });
    }

    return json(req, { error: 'Ação inválida.' }, 400);
  } catch (e) {
    console.error('[feedback-admin] catch:', e);
    return json(req, { error: errMsg(e) }, 500);
  }
});
