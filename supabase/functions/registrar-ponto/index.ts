import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"

const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000

function toBrasiliaDateStr(utcDate: Date): string {
  const ms = utcDate.getTime() + BRASILIA_OFFSET_MS
  return new Date(ms).toISOString().split('T')[0]
}

// Máquina de estados: dado o último tipo registrado, retorna o próximo
function getNextTipo(lastTipo: string | null): string {
  if (!lastTipo) return 'entrada'
  const seq: Record<string, string> = {
    entrada:         'saida_almoco',
    saida_almoco:    'retorno_almoco',
    retorno_almoco:  'saida',
    saida:           'extra_entrada',
    extra_entrada:   'extra_saida',
    extra_saida:     'extra_entrada',
  }
  return seq[lastTipo] ?? 'extra_entrada'
}

async function sha256hex(text: string): Promise<string> {
  const data   = new TextEncoder().encode(text)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { session_token } = await req.json()
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const SURL    = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb      = createClient(SURL, SERVICE)

    // Valida sessão
    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)

    const serverNow = new Date()
    const todayStr  = toBrasiliaDateStr(serverNow)

    const startOfToday = `${todayStr}T03:00:00.000Z`
    const nextDay      = new Date(serverNow.getTime() + BRASILIA_OFFSET_MS + 24 * 60 * 60 * 1000)
    const tomorrowStr  = nextDay.toISOString().split('T')[0]
    const endOfToday   = `${tomorrowStr}T03:00:00.000Z`

    // Busca registros de hoje (excluindo soft-deletados, ordenados por tempo)
    const { data: todayRecords } = await sb
      .from('ponto_registros')
      .select('id, tipo_registro, created_at')
      .eq('usuario_id', sessao.usuario_id)
      .is('deleted_at', null)
      .gte('created_at', startOfToday)
      .lt('created_at', endOfToday)
      .order('created_at', { ascending: true })

    const records = todayRecords || []

    // Debounce: rejeita se último registro foi há menos de 5 segundos
    if (records.length > 0) {
      const lastRecord = records[records.length - 1]
      const msSinceLast = serverNow.getTime() - new Date(lastRecord.created_at).getTime()
      if (msSinceLast < 5000) {
        return json(req, { error: 'Aguarde alguns segundos antes de registrar novamente.' }, 429)
      }
    }

    // Determina próximo tipo via state machine
    const lastTipo    = records.length > 0 ? records[records.length - 1].tipo_registro : null
    const tipoRegistro = getNextTipo(lastTipo)

    // Captura info do dispositivo/IP
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || null

    const deviceInfo = {
      user_agent: req.headers.get('user-agent') || null,
      ip:         ipAddress,
    }

    // Hash de integridade: prova que o timestamp foi definido server-side
    const timestampIso  = serverNow.toISOString()
    const hashInput     = `${sessao.usuario_id}:${tipoRegistro}:${timestampIso}`
    const hashValidacao = await sha256hex(hashInput)

    // Insere o registro — created_at usa DEFAULT now() do banco (imutável)
    const { data: inserted, error: insertError } = await sb
      .from('ponto_registros')
      .insert({
        usuario_id:     sessao.usuario_id,
        tipo_registro:  tipoRegistro,
        hash_validacao: hashValidacao,
        ip_address:     ipAddress,
        device_info:    deviceInfo,
      })
      .select('id, tipo_registro, created_at')
      .single()

    if (insertError || !inserted) {
      console.error('[registrar-ponto] Insert error:', insertError)
      return json(req, { error: 'Erro ao registrar ponto.' }, 500)
    }

    // Retorna o registro criado + lista atualizada do dia
    const updatedRecords = [...records, inserted]

    return json(req, {
      record:        inserted,
      today_records: updatedRecords,
    })

  } catch (e) {
    console.error('[registrar-ponto] Error:', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
