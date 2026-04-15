import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { session_token } = await req.json();
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);

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

    const { data, error } = await sb
      .from('usuarios')
      .select('id, username, nome, meta_account_id, foto_url, archived_at')
      .eq('role', 'cliente')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });

    if (error) throw error;

    return json(req, { clientes: data || [] });
  } catch (e) {
    return json(req, { error: String(e) }, 500);
  }
});
