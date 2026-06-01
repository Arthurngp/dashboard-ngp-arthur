import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession, isAdmin } from "../_shared/roles.ts"

// =============================================================================
// admin-ponto-manage
//
// Edge function admin para gerenciar ponto_registros manualmente. Cobre 3
// actions discriminadas no body:
//
//   create        → adicionar batida faltante (entrada/saida_almoco/...)
//   update        → editar batida existente (created_at / tipo / observacao)
//   mark_absence  → marcar dia inteiro ou faixa horária como ausência
//                   (atestado, feriado, folga, falta_justificada)
//
// Todas as actions exigem admin. UNIQUE parcial em
// (usuario_id, created_at, tipo_registro) WHERE deleted_at IS NULL → fazemos
// pre-check pra retornar 409 amigável em vez de erro genérico do banco.
// =============================================================================

const TIPOS_BATIDA = new Set([
  'entrada', 'saida_almoco', 'retorno_almoco', 'saida', 'extra',
])

const TIPOS_AUSENCIA = new Set([
  'atestado', 'feriado', 'folga', 'folga_aniversario', 'falta_justificada',
])

function isDateTimeStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
}

function isDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isHHmm(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s)
}

/** BRT (-03:00) → ISO UTC */
function brtToUtc(localIso: string): string {
  const withSec = localIso.length === 16 ? `${localIso}:00` : localIso
  return new Date(`${withSec}-03:00`).toISOString()
}

function rotuloAusencia(tipo: string): string {
  // 'falta_justificada' → 'FALTA JUSTIFICADA'
  return tipo.replace(/_/g, ' ').toUpperCase()
}

function montarObservacaoAusencia(
  tipo: string,
  hora_inicio: string | null,
  hora_fim: string | null,
  livre: string | null,
): string {
  const rotulo = rotuloAusencia(tipo)
  const faixa = hora_inicio && hora_fim ? ` ${hora_inicio}-${hora_fim}` : ''
  const sep = livre && livre.trim() ? ` | ${livre.trim()}` : ''
  return `${rotulo}${faixa}${sep}`
}

// deno-lint-ignore no-explicit-any
async function checarConflito(sb: any, usuario_id: string, created_at: string, tipo_registro: string, excluir_id?: string) {
  let q = sb.from('ponto_registros')
    .select('id')
    .eq('usuario_id', usuario_id)
    .eq('created_at', created_at)
    .eq('tipo_registro', tipo_registro)
    .is('deleted_at', null)
  if (excluir_id) q = q.neq('id', excluir_id)
  const { data, error } = await q.limit(1)
  if (error) throw new Error(`Erro no pre-check: ${error.message}`)
  return (data && data.length > 0)
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, action } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!isAdmin(user.role)) return json(req, { error: 'Apenas admins podem gerenciar batidas.' }, 403)

    // -------------------------------------------------------------------------
    // action: create
    // -------------------------------------------------------------------------
    if (action === 'create') {
      const { usuario_id, tipo_registro, data_hora, observacao } = body
      if (!usuario_id || typeof usuario_id !== 'string') {
        return json(req, { error: 'usuario_id obrigatório.' }, 400)
      }
      if (!TIPOS_BATIDA.has(tipo_registro)) {
        return json(req, { error: `tipo_registro inválido: ${tipo_registro}` }, 400)
      }
      if (!isDateTimeStr(data_hora)) {
        return json(req, { error: 'data_hora inválida (esperado YYYY-MM-DDTHH:mm).' }, 400)
      }

      const created_at = brtToUtc(data_hora)

      if (await checarConflito(sb, usuario_id, created_at, tipo_registro)) {
        return json(req, {
          error: 'Já existe uma batida deste tipo neste horário.',
          code: 'duplicate',
        }, 409)
      }

      const { data, error } = await sb.from('ponto_registros').insert({
        usuario_id,
        tipo_registro,
        created_at,
        observacao: observacao && String(observacao).trim() ? String(observacao).trim() : null,
        source: 'admin_manual',
      }).select('*').single()

      if (error) {
        console.error('[admin-ponto-manage] create error:', error)
        return json(req, { error: `Erro ao criar: ${error.message}` }, 500)
      }
      return json(req, { ok: true, record: data })
    }

    // -------------------------------------------------------------------------
    // action: update
    // -------------------------------------------------------------------------
    if (action === 'update') {
      const { record_id, data_hora, tipo_registro, observacao } = body
      if (!record_id || typeof record_id !== 'string') {
        return json(req, { error: 'record_id obrigatório.' }, 400)
      }
      const algumCampo = data_hora !== undefined || tipo_registro !== undefined || observacao !== undefined
      if (!algumCampo) {
        return json(req, { error: 'Pelo menos um campo deve ser alterado.' }, 400)
      }

      const { data: atual, error: errLoad } = await sb.from('ponto_registros')
        .select('*')
        .eq('id', record_id)
        .is('deleted_at', null)
        .single()
      if (errLoad || !atual) {
        return json(req, { error: 'Batida não encontrada.' }, 404)
      }

      const update: Record<string, unknown> = {
        edited_at: new Date().toISOString(),
        edited_by: user.usuario_id,
      }

      let novoCreatedAt: string | undefined
      let novoTipo: string | undefined

      if (data_hora !== undefined) {
        if (!isDateTimeStr(data_hora)) {
          return json(req, { error: 'data_hora inválida.' }, 400)
        }
        novoCreatedAt = brtToUtc(data_hora)
        update.created_at = novoCreatedAt
      }
      if (tipo_registro !== undefined) {
        if (!TIPOS_BATIDA.has(tipo_registro) && tipo_registro !== 'ausencia') {
          return json(req, { error: `tipo_registro inválido: ${tipo_registro}` }, 400)
        }
        novoTipo = tipo_registro
        update.tipo_registro = tipo_registro
      }
      if (observacao !== undefined) {
        update.observacao = observacao && String(observacao).trim() ? String(observacao).trim() : null
      }
      if (atual.source !== 'admin_edited' && atual.source !== 'admin_manual') {
        update.source = 'admin_edited'
      }

      // Pre-check UNIQUE se algo da chave mudou
      const mudouChave = novoCreatedAt !== undefined || novoTipo !== undefined
      if (mudouChave) {
        const conflitoCreated = novoCreatedAt ?? atual.created_at
        const conflitoTipo = novoTipo ?? atual.tipo_registro
        if (await checarConflito(sb, atual.usuario_id, conflitoCreated, conflitoTipo, record_id)) {
          return json(req, {
            error: 'Já existe uma batida deste tipo neste horário.',
            code: 'duplicate',
          }, 409)
        }
      }

      const { data, error } = await sb.from('ponto_registros')
        .update(update)
        .eq('id', record_id)
        .select('*')
        .single()

      if (error) {
        console.error('[admin-ponto-manage] update error:', error)
        return json(req, { error: `Erro ao atualizar: ${error.message}` }, 500)
      }
      return json(req, { ok: true, record: data })
    }

    // -------------------------------------------------------------------------
    // action: mark_absence
    // -------------------------------------------------------------------------
    if (action === 'mark_absence') {
      const {
        usuario_id, data, tipo_ausencia, escopo,
        hora_inicio, hora_fim, observacao,
        replace_existing, confirmed_keep,
      } = body

      if (!usuario_id || typeof usuario_id !== 'string') {
        return json(req, { error: 'usuario_id obrigatório.' }, 400)
      }
      if (!isDateStr(data)) {
        return json(req, { error: 'data inválida (esperado YYYY-MM-DD).' }, 400)
      }
      if (!TIPOS_AUSENCIA.has(tipo_ausencia)) {
        return json(req, { error: `tipo_ausencia inválido: ${tipo_ausencia}` }, 400)
      }
      if (escopo !== 'dia' && escopo !== 'faixa') {
        return json(req, { error: "escopo deve ser 'dia' ou 'faixa'." }, 400)
      }
      if (tipo_ausencia === 'folga_aniversario' && escopo !== 'dia') {
        return json(req, { error: 'Folga aniversário só pode ser marcada como dia inteiro.' }, 400)
      }
      if (escopo === 'faixa') {
        if (!isHHmm(hora_inicio) || !isHHmm(hora_fim)) {
          return json(req, { error: 'hora_inicio e hora_fim são obrigatórias na faixa.' }, 400)
        }
        if (hora_fim <= hora_inicio) {
          return json(req, { error: 'hora_fim deve ser maior que hora_inicio.' }, 400)
        }
      }

      // Detecta batidas existentes no dia (só importa em escopo 'dia' pra
      // perguntar ao admin; em escopo 'faixa' coexistem por padrão).
      const inicioDia = brtToUtc(`${data}T00:00`)
      const fimDia = brtToUtc(`${data}T23:59:59`)

      const { data: existentes, error: errExist } = await sb.from('ponto_registros')
        .select('id, tipo_registro, created_at, observacao')
        .eq('usuario_id', usuario_id)
        .gte('created_at', inicioDia)
        .lte('created_at', fimDia)
        .is('deleted_at', null)
      if (errExist) {
        return json(req, { error: `Erro ao consultar dia: ${errExist.message}` }, 500)
      }

      const batidasExistentes = (existentes || []).filter((r: { tipo_registro: string }) =>
        r.tipo_registro !== 'ausencia'
      )

      // Em escopo 'dia' com batidas e sem decisão do admin → devolve pra UI perguntar
      if (escopo === 'dia' && batidasExistentes.length > 0 && !replace_existing && !confirmed_keep) {
        return json(req, {
          ok: false,
          code: 'has_existing',
          existing_records: batidasExistentes,
        })
      }

      // Se replace_existing → soft-delete das batidas do dia
      if (escopo === 'dia' && replace_existing && batidasExistentes.length > 0) {
        const ids = batidasExistentes.map((r: { id: string }) => r.id)
        const { error: errDel } = await sb.from('ponto_registros')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user.usuario_id })
          .in('id', ids)
        if (errDel) {
          return json(req, { error: `Erro ao remover batidas: ${errDel.message}` }, 500)
        }
      }

      // created_at da ausência: início da faixa ou 00:00 do dia
      const horaBase = escopo === 'faixa' ? (hora_inicio as string) : '00:00'
      const created_at = brtToUtc(`${data}T${horaBase}`)

      // Pre-check: já existe ausencia no mesmo timestamp? Se sim, 409.
      if (await checarConflito(sb, usuario_id, created_at, 'ausencia')) {
        return json(req, {
          error: 'Já existe uma ausência marcada neste horário.',
          code: 'duplicate',
        }, 409)
      }

      const obsFinal = montarObservacaoAusencia(
        tipo_ausencia,
        escopo === 'faixa' ? (hora_inicio as string) : null,
        escopo === 'faixa' ? (hora_fim as string) : null,
        observacao || null,
      )

      const { data: novo, error: errIns } = await sb.from('ponto_registros').insert({
        usuario_id,
        tipo_registro: 'ausencia',
        created_at,
        observacao: obsFinal,
        source: 'admin_manual',
      }).select('*').single()

      if (errIns) {
        console.error('[admin-ponto-manage] mark_absence error:', errIns)
        return json(req, { error: `Erro ao marcar ausência: ${errIns.message}` }, 500)
      }
      return json(req, { ok: true, record: novo })
    }

    return json(req, { error: 'Ação inválida.' }, 400)

  } catch (e) {
    console.error('[admin-ponto-manage] Error:', e)
    const msg = e instanceof Error ? e.message : 'Erro interno.'
    return json(req, { error: msg }, 500)
  }
})
