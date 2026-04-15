import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { session_token, id, username, nome, meta_account_id, investimento_autorizado_mensal, foto_base64, foto_mime } = await req.json();

    if (!session_token) {
      return json(req, { error: 'Sessão inválida.' }, 401);
    }

    if ((!id && !username) || !nome) {
      return json(req, { error: 'Id/username e nome são obrigatórios.' }, 400);
    }

    const SURL    = Deno.env.get('SUPABASE_URL')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb      = createClient(SURL, SERVICE);

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('id, usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!sessao) {
      return json(req, { error: 'Sessão expirada. Faça login novamente.' }, 401);
    }

    // Verifica se é NGP
    const { data: usuario } = await sb
      .from('usuarios')
      .select('role')
      .eq('id', sessao.usuario_id)
      .single();

    if (!usuario || (usuario.role !== 'ngp' && usuario.role !== 'admin')) {
      return json(req, { error: 'Acesso negado.' }, 403);
    }

    const updateData: Record<string, string | number | null> = { nome: nome.trim() };
    updateData.meta_account_id = meta_account_id ? meta_account_id.trim() : null;

    if (investimento_autorizado_mensal === '' || investimento_autorizado_mensal === null || investimento_autorizado_mensal === undefined) {
      updateData.investimento_autorizado_mensal = null;
    } else {
      const investimento = Number(investimento_autorizado_mensal);
      if (!Number.isFinite(investimento) || investimento < 0) {
        return json(req, { error: 'Investimento autorizado inválido.' }, 400);
      }
      updateData.investimento_autorizado_mensal = Math.round(investimento * 100) / 100;
    }

    // Upload de foto se fornecida
    let fotoUrl: string | null = null;
    if (foto_base64 && foto_mime) {
      const ext  = foto_mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const path = `${username.trim().toLowerCase()}/avatar.${ext}`;
      const bytes = Uint8Array.from(atob(foto_base64), c => c.charCodeAt(0));

      const { error: uploadErr } = await sb.storage
        .from('avatars')
        .upload(path, bytes, { contentType: foto_mime, upsert: true });

      if (uploadErr) throw new Error('Erro no upload da foto: ' + uploadErr.message);

      fotoUrl = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      fotoUrl += '?v=' + Date.now();
      updateData.foto_url = fotoUrl;
    }

    // Prefere filtrar por id (imutável), fallback para username
    let query = sb.from('usuarios').update(updateData).eq('role', 'cliente');
    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('username', username.trim());
    }
    const { error } = await query;

    if (error) throw error;

    return json(req, { ok: true, foto_url: fotoUrl });

  } catch (e) {
    return json(req, { error: String(e) }, 500);
  }
});
