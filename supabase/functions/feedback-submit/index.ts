import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from '../_shared/cors.ts';

const errMsg = (e: unknown): string => {
  if (!e) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const obj = e as Record<string, unknown>;
  return String(obj.message || obj.details || obj.hint || obj.code || JSON.stringify(e));
};

const PRIORIDADES = new Set(['baixa', 'media', 'alta', 'critica']);
const TIPOS       = new Set(['bug', 'erro', 'sugestao', 'duvida', 'outro']);

// Limites para evitar abuso de upload
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const {
      session_token,
      titulo,
      tipo,
      prioridade,
      mensagem,
      pagina_url,
      user_agent,
      screenshot_base64,
      screenshot_mime,
    } = await req.json();

    if (!session_token)        return json(req, { error: 'Sessão inválida.' }, 401);
    if (!mensagem?.trim())     return json(req, { error: 'Mensagem é obrigatória.' }, 400);

    const tipoSafe       = TIPOS.has(tipo) ? tipo : 'outro';
    const prioridadeSafe = PRIORIDADES.has(prioridade) ? prioridade : 'media';

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
      .select('nome, role, foto_url')
      .eq('id', sessao.usuario_id)
      .single();

    // Upload opcional de screenshot
    let screenshotUrl: string | null = null;
    if (screenshot_base64 && screenshot_mime) {
      try {
        if (!screenshot_mime.startsWith('image/')) {
          return json(req, { error: 'Anexo precisa ser uma imagem.' }, 400);
        }
        const bytes = Uint8Array.from(atob(screenshot_base64), c => c.charCodeAt(0));
        if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
          return json(req, { error: 'Imagem maior que 5MB.' }, 400);
        }
        const ext  = screenshot_mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const path = `${sessao.usuario_id}/${Date.now()}.${ext}`;

        const { error: uploadErr } = await sb.storage
          .from('feedback-screenshots')
          .upload(path, bytes, { contentType: screenshot_mime, upsert: false });

        if (uploadErr) {
          console.error('[feedback-submit] upload error:', uploadErr.message);
        } else {
          screenshotUrl = sb.storage.from('feedback-screenshots').getPublicUrl(path).data.publicUrl;
        }
      } catch (e) {
        console.error('[feedback-submit] screenshot decode error:', e);
      }
    }

    const tituloSafe = typeof titulo === 'string' ? titulo.trim().slice(0, 140) : null;

    const { error } = await sb.from('feedback').insert({
      usuario_id:     sessao.usuario_id,
      usuario_nome:   usuario?.nome ?? null,
      usuario_role:   usuario?.role ?? null,
      usuario_foto:   usuario?.foto_url ?? null,
      titulo:         tituloSafe || null,
      tipo:           tipoSafe,
      prioridade:     prioridadeSafe,
      mensagem:       mensagem.trim(),
      pagina_url:     pagina_url ?? null,
      user_agent:     user_agent ?? null,
      screenshot_url: screenshotUrl,
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
