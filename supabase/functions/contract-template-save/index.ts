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
    const { session_token, conteudo, nome } = await req.json();

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);
    if (!conteudo?.trim()) return json(req, { error: 'Conteúdo do template é obrigatório.' }, 400);

    const SURL    = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb      = createClient(SURL, SERVICE);

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

    if (!usuario || (usuario.role !== 'ngp' && usuario.role !== 'admin')) {
      return json(req, { error: 'Acesso negado.' }, 403);
    }

    const { error } = await sb
      .from('contract_templates')
      .upsert({
        slug:       'default',
        nome:       nome?.trim() || 'Template Oficial NGP',
        conteudo:   conteudo.trim(),
        updated_by: sessao.usuario_id,
      }, { onConflict: 'slug' });

    if (error) {
      console.error('[contract-template-save] upsert error:', JSON.stringify(error));
      return json(req, { error: errMsg(error) }, 500);
    }

    return json(req, { ok: true });
  } catch (e) {
    console.error('[contract-template-save] catch:', e);
    return json(req, { error: errMsg(e) }, 500);
  }
});
