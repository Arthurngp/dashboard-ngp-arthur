import { serve } from "std/http/server"
import { createClient } from "supabase"
import { handleCors, json } from "../_shared/cors.ts"
import { validateSession } from "../_shared/roles.ts"

async function checkFinanceiroAccess(sb: any, usuario_id: string): Promise<boolean> {
  const { data } = await sb.from('usuarios').select('acesso_financeiro, ativo').eq('id', usuario_id).single()
  return !!data?.acesso_financeiro && !!data?.ativo
}

// dia_fechamento define o mês de referência da fatura:
//   compete_date.day > dia_fechamento → fatura do MÊS SEGUINTE
function faturaMesRef(competence_date: string, dia_fechamento: number | null): string {
  const d = new Date(competence_date + 'T00:00:00')
  let y = d.getFullYear()
  let m = d.getMonth() + 1
  if (dia_fechamento && d.getDate() > dia_fechamento) {
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  const mm = String(m).padStart(2, '0')
  return `${y}-${mm}-01`
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
    const isCaixa = view === 'caixa'

    // ── Estratégia ──────────────────────────────────────────────────────────
    // Competência: filtra por competence_date.
    // Caixa: filtra por payment_date (transações bancárias normais).
    //        Para lançamentos em CARTÃO (sem payment_date), o "caixa" deles
    //        é a data dos pagamentos da fatura correspondente — distribuído
    //        proporcionalmente entre os pagamentos da fatura.
    //
    // Em ambos os modos, is_card_payment=true continua excluído (a saída do
    // pagamento da fatura não é despesa por si só — as compras é que são).

    // Bloco 1: transações "regulares" — para o modo caixa, exclui contas de
    // cartão (que serão tratadas via faturas no bloco 2).
    let q = sb.from('fin_transacoes')
      .select('tipo, valor, status, competence_date, payment_date, account_id, categoria_id, categoria:fin_categorias(id, nome, tipo), account:fin_accounts!inner(id,ativo,tipo,dia_fechamento)')
      .neq('tipo', 'transferencia')
      .eq('is_card_payment', false)

    if (isCaixa) {
      q = q.eq('status', 'confirmado').not('payment_date', 'is', null)
        .gte('payment_date', start).lte('payment_date', end)
      // Cartões saem deste bloco — entram pelo bloco 2 via fatura.
      q = q.not('account.tipo', 'in', '(cartao_credito,cartao)')
    } else {
      q = q.gte('competence_date', start).lte('competence_date', end)
    }

    if (account_id) {
      q = q.eq('account_id', account_id)
    } else {
      q = q.eq('account.ativo', true)
    }

    const { data: txs, error } = await q
    if (error) return json(req, { error: 'Erro ao buscar transações.' }, 500)

    type CellValue = { confirmado: number; pendente: number }
    type CatRow = {
      categoria_id: string | null
      categoria_nome: string
      tipo: 'entrada' | 'saida'
      meses: CellValue[]
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

      const dateStr: string = isCaixa ? (tx.payment_date ?? tx.competence_date) : tx.competence_date
      const mes = new Date(dateStr + 'T00:00:00').getMonth()
      if (mes < 0 || mes > 11) continue

      const row = getOrCreate(cat_id, cat_nome, tipo)
      const valor = Math.abs(Number(tx.valor))
      if (tx.status === 'confirmado') row.meses[mes].confirmado += valor
      else row.meses[mes].pendente += valor
    }

    // ── Bloco 2: cartões em modo CAIXA, via faturas ─────────────────────────
    // Para cada compra em cartão:
    // - se a fatura correspondente teve pagamentos NO ANO, distribui o valor
    //   proporcionalmente entre cada pagamento (na data de cada um).
    // - compras de faturas ainda não pagas ficam fora.
    if (isCaixa) {
      // 2.1) Carrega contas de cartão (todas, ativas se sem account_id filtro).
      let cartoesQ = sb.from('fin_accounts').select('id,nome,tipo,dia_fechamento,ativo')
        .in('tipo', ['cartao_credito', 'cartao'])
      if (!account_id) cartoesQ = cartoesQ.eq('ativo', true)
      else cartoesQ = cartoesQ.eq('id', account_id)
      const cartoesRes = await cartoesQ
      const cartoes = (cartoesRes.data || []) as Array<{ id: string; dia_fechamento: number | null }>

      if (cartoes.length > 0) {
        const cartaoIds = cartoes.map(c => c.id)
        const cartaoById = new Map(cartoes.map(c => [c.id, c]))

        // 2.2) Lançamentos do cartão (independente do ano de competence_date —
        //      o que importa é a fatura cair com pagamento no ano).
        const lancRes = await sb.from('fin_transacoes')
          .select('id, tipo, valor, status, competence_date, account_id, categoria_id, categoria:fin_categorias(id, nome, tipo)')
          .in('account_id', cartaoIds)
          .neq('tipo', 'transferencia')
          .eq('is_card_payment', false)
        if (lancRes.error) return json(req, { error: 'Erro ao buscar lançamentos de cartão.' }, 500)
        const lancs = lancRes.data || []

        // 2.3) Faturas + seus pagamentos (no ano).
        const fatRes = await sb.from('fin_cartao_faturas')
          .select('id,cartao_id,mes_ref,valor,valor_pago,status')
          .in('cartao_id', cartaoIds)
          .in('status', ['parcial', 'paga'])
        const faturas = fatRes.data || []
        const fatByKey = new Map<string, any>()
        for (const f of faturas) fatByKey.set(`${f.cartao_id}|${String(f.mes_ref).slice(0, 10)}`, f)

        const pagsRes = await sb.from('fin_cartao_fatura_pagamentos')
          .select('id,fatura_id,valor,paid_at')
          .gte('paid_at', start).lte('paid_at', end)
          .in('fatura_id', faturas.map((f: any) => f.id))
        const pagsByFatura = new Map<string, Array<{ valor: number; paid_at: string }>>()
        for (const p of pagsRes.data || []) {
          const arr = pagsByFatura.get(p.fatura_id) || []
          arr.push({ valor: Number(p.valor || 0), paid_at: String(p.paid_at).slice(0, 10) })
          pagsByFatura.set(p.fatura_id, arr)
        }

        // 2.4) Para cada lançamento, encontra fatura e distribui valor pelos pagamentos.
        for (const l of lancs) {
          const cart = cartaoById.get(l.account_id)
          if (!cart || !l.competence_date) continue
          const mesRef = faturaMesRef(l.competence_date, cart.dia_fechamento)
          const fatura = fatByKey.get(`${l.account_id}|${mesRef}`)
          if (!fatura) continue
          const pags = pagsByFatura.get(fatura.id) || []
          if (pags.length === 0) continue

          const valorLanc = Math.abs(Number(l.valor || 0))
          const tipo: 'entrada' | 'saida' = l.tipo === 'entrada' ? 'entrada' : 'saida'
          const cat = l.categoria as { id: string; nome: string; tipo: string } | null
          const cat_id = cat?.id ?? null
          const cat_nome = cat?.nome ?? (tipo === 'entrada' ? 'Receitas sem categoria' : 'Despesas sem categoria')
          const row = getOrCreate(cat_id, cat_nome, tipo)

          const totalPagos = pags.reduce((s, p) => s + p.valor, 0)
          if (totalPagos <= 0) continue

          for (const p of pags) {
            const proporcao = p.valor / totalPagos
            const parcela = valorLanc * proporcao
            const mes = new Date(p.paid_at + 'T00:00:00').getMonth()
            if (mes < 0 || mes > 11) continue
            if (l.status === 'confirmado') row.meses[mes].confirmado += parcela
            else row.meses[mes].pendente += parcela
          }
        }
      }
    }

    const entradas = Array.from(rowMap.values())
      .filter(r => r.tipo === 'entrada')
      .sort((a, b) => a.categoria_nome.localeCompare(b.categoria_nome))
    const saidas = Array.from(rowMap.values())
      .filter(r => r.tipo === 'saida')
      .sort((a, b) => a.categoria_nome.localeCompare(b.categoria_nome))

    const totalEntradas: CellValue[] = Array.from({ length: 12 }, () => ({ confirmado: 0, pendente: 0 }))
    const totalSaidas: CellValue[]   = Array.from({ length: 12 }, () => ({ confirmado: 0, pendente: 0 }))
    for (const row of entradas) for (let m = 0; m < 12; m++) {
      totalEntradas[m].confirmado += row.meses[m].confirmado
      totalEntradas[m].pendente   += row.meses[m].pendente
    }
    for (const row of saidas) for (let m = 0; m < 12; m++) {
      totalSaidas[m].confirmado += row.meses[m].confirmado
      totalSaidas[m].pendente   += row.meses[m].pendente
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
