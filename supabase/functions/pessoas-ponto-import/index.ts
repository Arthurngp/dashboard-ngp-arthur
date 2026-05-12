import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

// Tipos válidos espelhados do schema
const TIPOS_VALIDOS = new Set([
  'entrada', 'saida_almoco', 'retorno_almoco', 'saida', 'extra', 'ausencia',
])

interface BatidaPayload {
  usuario_id: string
  created_at_iso: string  // YYYY-MM-DDTHH:mm:ss
  tipo_registro: string
  observacao?: string | null
}

function isISODateTime(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)
}

function toTimestampTz(iso: string): string {
  // Adiciona timezone -03:00 (Brasil). Banco armazena como TIMESTAMPTZ.
  return `${iso}-03:00`
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Apenas admins podem importar.' }, 403)

    if (action === 'listar_usuarios') {
      // Lista colaboradores: ativos, não arquivados, com cargo preenchido.
      // O cargo preenchido distingue colaborador real de cliente/placeholder/duplicata.
      const { data, error } = await sb.from('usuarios')
        .select('id,nome,username,cargo,funcao')
        .eq('ativo', true)
        .is('archived_at', null)
        .not('cargo', 'is', null)
        .neq('cargo', '')
        .order('nome')
      if (error) return json(req, { error: 'Erro ao buscar usuários.' }, 500)
      return json(req, { usuarios: data || [] })
    }

    if (action === 'importar') {
      const { batidas } = body as { batidas: BatidaPayload[] }
      if (!Array.isArray(batidas) || batidas.length === 0) {
        return json(req, { error: 'Nenhuma batida para importar.' }, 400)
      }
      if (batidas.length > 5000) {
        return json(req, { error: 'Máximo 5000 batidas por lote. Divida em vários imports.' }, 400)
      }

      // Validação por batida
      const valid: any[] = []
      const errors: { index: number; reason: string }[] = []
      for (let i = 0; i < batidas.length; i++) {
        const b = batidas[i]
        if (!b.usuario_id || typeof b.usuario_id !== 'string') {
          errors.push({ index: i, reason: 'usuario_id ausente' }); continue
        }
        if (!b.created_at_iso || !isISODateTime(b.created_at_iso)) {
          errors.push({ index: i, reason: `created_at_iso inválido: ${b.created_at_iso}` }); continue
        }
        if (!TIPOS_VALIDOS.has(b.tipo_registro)) {
          errors.push({ index: i, reason: `tipo_registro inválido: ${b.tipo_registro}` }); continue
        }
        valid.push({
          usuario_id: b.usuario_id,
          created_at: toTimestampTz(b.created_at_iso),
          tipo_registro: b.tipo_registro,
          observacao: b.observacao || null,
          source: 'import',
        })
      }

      if (valid.length === 0) {
        return json(req, { inserted: 0, skipped: 0, errors }, 200)
      }

      // Dedup manual: o índice UNIQUE de ponto_registros é PARCIAL
      // (WHERE deleted_at IS NULL), e PostgREST/Supabase upsert não envia
      // WHERE no ON CONFLICT — então buscamos chaves existentes antes
      // e filtramos in-memory, fazendo INSERT puro só do que falta.
      let inserted = 0
      let skipped = 0

      // 1) Pega chaves (usuario_id, created_at, tipo_registro) existentes
      //    no range mín/máx das batidas a importar, paginado.
      const dates = valid.map(b => b.created_at).sort()
      const minDate = dates[0]
      const maxDate = dates[dates.length - 1]
      const usuarioIds = Array.from(new Set(valid.map(b => b.usuario_id)))
      const existingKeys = new Set<string>()
      let offRead = 0
      while (true) {
        const { data, error } = await sb.from('ponto_registros')
          .select('usuario_id,created_at,tipo_registro')
          .is('deleted_at', null)
          .in('usuario_id', usuarioIds)
          .gte('created_at', minDate)
          .lte('created_at', maxDate)
          .order('created_at', { ascending: true })
          .range(offRead, offRead + 999)
        if (error) {
          return json(req, { error: `Erro ao carregar batidas existentes: ${error.message}` }, 500)
        }
        if (!data || data.length === 0) break
        for (const r of data) {
          existingKeys.add(`${r.usuario_id}|${new Date(r.created_at).toISOString()}|${r.tipo_registro}`)
        }
        if (data.length < 1000) break
        offRead += 1000
      }

      // 2) Filtra o que já existe e faz INSERT em batches de 500.
      const novos: any[] = []
      for (const row of valid) {
        const key = `${row.usuario_id}|${new Date(row.created_at).toISOString()}|${row.tipo_registro}`
        if (existingKeys.has(key)) { skipped++; continue }
        existingKeys.add(key) // dedup dentro do próprio lote
        novos.push(row)
      }

      const BATCH = 500
      for (let off = 0; off < novos.length; off += BATCH) {
        const slice = novos.slice(off, off + BATCH)
        const { data, error } = await sb
          .from('ponto_registros')
          .insert(slice)
          .select('id')
        if (error) {
          return json(req, {
            error: `Erro ao inserir lote ${Math.floor(off / BATCH) + 1}: ${error.message}`,
            inserted, skipped, errors,
          }, 500)
        }
        inserted += data?.length || 0
      }

      return json(req, { inserted, skipped, errors }, 200)
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e: any) {
    console.error('[pessoas-ponto-import] Error:', e)
    return json(req, { error: e?.message || 'Erro interno.' }, 500)
  }
})
