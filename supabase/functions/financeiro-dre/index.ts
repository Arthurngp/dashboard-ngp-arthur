import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, ano, account_id, view = 'competencia' } = body
    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const user = await validateSession(sb, session_token)
    if (!user) return json(req, { error: 'Sessão expirada.' }, 401)
    if (!await checkFinanceiroAccess(sb, user.usuario_id)) return json(req, { error: 'Acesso não autorizado.' }, 403)

    const anoNum = Number(ano) || new Date().getFullYear()
    const start = `${anoNum}-01-01`
    const end = `${anoNum}-12-31`
    const dateField = view === 'caixa' ? 'payment_date' : 'competence_date'

    // Busca todas as transações do ano
    let q = sb.from('fin_transacoes')
      .select('tipo, valor, status, competence_date, payment_date, categoria_id, categoria:fin_categorias(id, nome, tipo), account:fin_accounts!inner(id,ativo)')
      .gte(dateField, start)
      .lte(dateField, end)

    // No modo caixa, só confirmadas com payment_date
    if (view === 'caixa') {
      q = q.eq('status', 'confirmado').not('payment_date', 'is', null)
    }

    if (account_id) {
      q = q.eq('account_id', account_id)
    } else {
      // Oculta contas arquivadas via join (evita query extra)
      q = q.eq('account.ativo', true)
    }

    const { data: txs, error } = await q
    if (error) return json(req, { error: 'Erro ao buscar transações.' }, 500)

    // Monta estrutura: categoria -> mes -> { confirmado, pendente }
    // mes = 1..12
    type CellValue = { confirmado: number; pendente: number }
    type CatRow = {
      categoria_id: string | null
      categoria_nome: string
      tipo: 'entrada' | 'saida'
      meses: CellValue[]  // índice 0 = jan, 11 = dez
    }

    const rowMap = new Map<string, CatRow>()

    const getOrCreate = (cat_id: string | null, cat_nome: string, tipo: 'entrada' | 'saida'): CatRow => {
      const key = cat_id ?? `__sem_cat_${tipo}`
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          categoria_id: cat_id,
          categoria_nome: cat_nome,
          tipo,
          meses: Array.from({ length: 12 }, () => ({ confirmado: 0, pendente: 0 })),
        })
      }
      return rowMap.get(key)!
    }

    for (const tx of txs ?? []) {
      const tipo: 'entrada' | 'saida' = tx.tipo === 'entrada' ? 'entrada' : 'saida'
      const cat = tx.categoria as { id: string; nome: string; tipo: string } | null
      const cat_id = cat?.id ?? null
      const cat_nome = cat?.nome ?? (tipo === 'entrada' ? 'Receitas sem categoria' : 'Despesas sem categoria')

      const dateStr: string = view === 'caixa' ? (tx.payment_date ?? tx.competence_date) : tx.competence_date
      const mes = new Date(dateStr + 'T00:00:00').getMonth() // 0-based
      if (mes < 0 || mes > 11) continue

      const row = getOrCreate(cat_id, cat_nome, tipo)
      const valor = Math.abs(Number(tx.valor))
      if (tx.status === 'confirmado') {
        row.meses[mes].confirmado += valor
      } else {
        row.meses[mes].pendente += valor
      }
    }

    // Separa entradas e saídas, ordena por nome
    const entradas = Array.from(rowMap.values())
      .filter(r => r.tipo === 'entrada')
      .sort((a, b) => a.categoria_nome.localeCompare(b.categoria_nome))

    const saidas = Array.from(rowMap.values())
      .filter(r => r.tipo === 'saida')
      .sort((a, b) => a.categoria_nome.localeCompare(b.categoria_nome))

    // Totais por mês
    const totalEntradas: CellValue[] = Array.from({ length: 12 }, () => ({ confirmado: 0, pendente: 0 }))
    const totalSaidas: CellValue[]   = Array.from({ length: 12 }, () => ({ confirmado: 0, pendente: 0 }))

    for (const row of entradas) {
      for (let m = 0; m < 12; m++) {
        totalEntradas[m].confirmado += row.meses[m].confirmado
        totalEntradas[m].pendente   += row.meses[m].pendente
      }
    }
    for (const row of saidas) {
      for (let m = 0; m < 12; m++) {
        totalSaidas[m].confirmado += row.meses[m].confirmado
        totalSaidas[m].pendente   += row.meses[m].pendente
      }
    }

    const resultado: CellValue[] = Array.from({ length: 12 }, (_, m) => ({
      confirmado: totalEntradas[m].confirmado - totalSaidas[m].confirmado,
      pendente:   totalEntradas[m].pendente   - totalSaidas[m].pendente,
    }))

    return json(req, {
      ano: anoNum,
      view,
      entradas,
      saidas,
      total_entradas: totalEntradas,
      total_saidas: totalSaidas,
      resultado,
    })

  } catch (e) {
    console.error('[financeiro-dre]', e)
    return json(req, { error: 'Erro interno.' }, 500)
  }
})
