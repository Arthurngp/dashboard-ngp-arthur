import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { session_token, action, id } = await req.json();

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);
    if (!id) return json(req, { error: 'ID da conta é obrigatório.' }, 400);
    if (!['archive', 'restore'].includes(action)) return json(req, { error: 'Ação inválida.' }, 400);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

    if (!usuario || !['ngp', 'admin'].includes(usuario.role)) {
      return json(req, { error: 'Acesso negado.' }, 403);
    }

    const updateData = action === 'archive'
      ? { archived_at: new Date().toISOString(), archived_by: sessao.usuario_id }
      : { archived_at: null, archived_by: null };

    const { error } = await sb
      .from('usuarios')
      .update(updateData)
      .eq('id', id)
      .eq('role', 'cliente');

    if (error) throw error;

    return json(req, { ok: true });
  } catch (e) {
    return json(req, { error: String(e) }, 500);
  }
});
