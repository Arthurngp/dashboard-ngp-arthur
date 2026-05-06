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
    const { session_token } = await req.json();

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401);

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

    const { data, error } = await sb
      .from('contract_templates')
      .select('conteudo, nome, updated_at')
      .eq('slug', 'default')
      .maybeSingle();

    if (error) {
      console.error('[contract-template-load] select error:', JSON.stringify(error));
      return json(req, { error: errMsg(error) }, 500);
    }

    return json(req, { template: data ?? null });
  } catch (e) {
    console.error('[contract-template-load] catch:', e);
    return json(req, { error: errMsg(e) }, 500);
  }
});
