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
    const { session_token, tipo, mensagem, pagina_url, user_agent } = await req.json();

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);
    if (!mensagem?.trim()) return json(req, { error: 'Mensagem é obrigatória.' }, 400);

    const SURL    = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb      = createClient(SURL, SERVICE);

    // Valida sessão e busca dados do usuário
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401);

    const { data: usuario } = await sb
      .from('usuarios')
      .select('nome, role')
      .eq('id', sessao.usuario_id)
      .single();

    const { error } = await sb.from('feedback').insert({
      usuario_id:   sessao.usuario_id,
      usuario_nome: usuario?.nome ?? null,
      usuario_role: usuario?.role ?? null,
      tipo:         tipo ?? 'outro',
      mensagem:     mensagem.trim(),
      pagina_url:   pagina_url ?? null,
      user_agent:   user_agent ?? null,
    });

    if (error) {
      console.error('[feedback-submit] insert error:', JSON.stringify(error));
      return json(req, { error: errMsg(error) }, 500);
    }

    return json(req, { ok: true });
  } catch (e) {
    console.error('[feedback-submit] catch:', e);
    return json(req, { error: errMsg(e) }, 500);
  }
});
