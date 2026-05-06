import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFinanceiroAgentFallback,
  buildFinanceiroAgentPeriod,
  detectFinanceiroAgentIntent,
  summarizeFinanceiroAgentTotals,
} from '../lib/financeiro-agent'

test('detectFinanceiroAgentIntent identifica pedidos comuns do financeiro', () => {
  assert.equal(detectFinanceiroAgentIntent('quais riscos de atraso temos?'), 'risks')
  assert.equal(detectFinanceiroAgentIntent('monta uma previsão de caixa'), 'forecast')
  assert.equal(detectFinanceiroAgentIntent('revisar categorias sem centro de custo'), 'categorization')
  assert.equal(detectFinanceiroAgentIntent('me dá um resumo do mês'), 'briefing')
})

test('buildFinanceiroAgentPeriod usa periodo informado quando valido', () => {
  const period = buildFinanceiroAgentPeriod(new Date('2026-05-03T12:00:00Z'), {
    start: '2026-04-01',
    end: '2026-04-30',
    label: 'Abril',
  })

  assert.deepEqual(period, { start: '2026-04-01', end: '2026-04-30', label: 'Abril' })
})

test('buildFinanceiroAgentPeriod cai para mes atual quando periodo e invalido', () => {
  const period = buildFinanceiroAgentPeriod(new Date('2026-05-03T12:00:00Z'), {
    start: '2026-05-31',
    end: '2026-05-01',
  })

  assert.deepEqual(period, { start: '2026-05-01', end: '2026-05-31', label: 'Mês atual' })
})

test('summarizeFinanceiroAgentTotals separa realizado e pendente', () => {
  const totals = summarizeFinanceiroAgentTotals([
    { tipo: 'entrada', valor: 1000, status: 'confirmado' },
    { tipo: 'entrada', valor: '500', status: 'pendente' },
    { tipo: 'saida', valor: 300, status: 'confirmado' },
    { tipo: 'saida', valor: '200', status: 'pendente' },
  ])

  assert.deepEqual(totals, {
    entradas: 1000,
    saidas: 300,
    saldo: 700,
    pendenteEntrada: 500,
    pendenteSaida: 200,
  })
})

test('buildFinanceiroAgentFallback prioriza pendencias e saldo negativo', () => {
  const actions = buildFinanceiroAgentFallback({
    entradas: 100,
    saidas: 300,
    saldo: -200,
    pendenteEntrada: 50,
    pendenteSaida: 20,
  })

  assert.equal(actions.length, 3)
  assert.match(actions.join(' '), /entradas pendentes/)
  assert.match(actions.join(' '), /despesas pendentes/)
  assert.match(actions.join(' '), /negativo/)
})
