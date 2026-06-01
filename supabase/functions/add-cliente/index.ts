import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, json } from "../_shared/cors.ts";

const PBKDF2_ITERATIONS = 100_000;

async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

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
    const { session_token, nome, username, meta_account_id, google_ads_customer_id, senha, foto_base64, foto_mime } = await req.json();

    if (!session_token) {
      return json(req, { error: 'Sessão inválida.' }, 401);
    }

    if (!nome || !username) {
      return json(req, { error: 'Nome e username são obrigatórios.' }, 400);
    }

    if (!senha) {
      return json(req, { error: 'Senha é obrigatória.' }, 400);
    }

    // Validação de senha forte
    if (typeof senha !== 'string' || senha.length < 8) {
      return json(req, { error: 'Senha deve ter pelo menos 8 caracteres.' }, 400);
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

    // Verifica se username já existe
    const { data: existing } = await sb
      .from('usuarios')
      .select('id')
      .eq('username', username.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return json(req, { error: 'Username já está em uso.' }, 409);
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
      if (!uploadErr) {
        fotoUrl = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      }
    }

    // Hash da senha com PBKDF2 (mesmo formato usado pelo login)
    const hashedPassword = await hashPasswordPbkdf2(senha);

    const insertData: Record<string, unknown> = {
      nome:          nome.trim(),
      username:      username.trim().toLowerCase(),
      role:          'cliente',
      ativo:         true,
      password_hash: hashedPassword,
    };
    if (meta_account_id) insertData.meta_account_id = meta_account_id.trim();

    // Google Ads customer_id: aceita "123-456-7890" ou "1234567890". Armazena sem hífens.
    if (google_ads_customer_id) {
      const googleAdsClean = String(google_ads_customer_id).trim().replace(/-/g, '');
      if (!/^\d{10}$/.test(googleAdsClean)) {
        return json(req, { error: 'Google Ads Customer ID inválido. Use 10 dígitos (ex: 123-456-7890).' }, 400);
      }
      insertData.google_ads_customer_id = googleAdsClean;
    }

    if (fotoUrl) insertData.foto_url = fotoUrl;

    const { error } = await sb.from('usuarios').insert(insertData);

    if (error) {
      console.error('[add-cliente] insert error:', JSON.stringify(error));
      return json(req, { error: errMsg(error) }, 500);
    }

    return json(req, { ok: true });

  } catch (e) {
    console.error('[add-cliente] catch:', e);
    return json(req, { error: errMsg(e) }, 500);
  }
});
