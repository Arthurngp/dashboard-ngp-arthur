import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_CONTRACT_DRAFT,
  applyContractTemplate,
  buildContractChangeConfirmation,
  buildContractConfirmationSummary,
  buildContractFileName,
  buildContractMissingPrompt,
  getChangedContractFields,
  getContractCompletion,
  getMissingContractFields,
  hydrateContractDraft,
  isPositiveConfirmation,
  mergeContractDraft,
} from '../lib/contracts'

test('mergeContractDraft normaliza campos essenciais e hidrata derivados', () => {
  const draft = mergeContractDraft(EMPTY_CONTRACT_DRAFT, {
    nomeCliente: 'AWA Construcoes e Incorporacoes LTDA',
    cnpjCliente: '23569125000132',
    telefoneCliente: '8198369779',
    cpfResponsavel: '07596293409',
    valorMensal: '3190',
    diaVencimento: '28',
    vencimentoParcela1: '2026-04-28',
    dataContrato: '2026-04-28',
    cidadeContrato: 'caruaru',
  })

  assert.equal(draft.cnpjCliente, '23.569.125/0001-32')
  assert.equal(draft.telefoneCliente, '(81) 9836-9779')
  assert.equal(draft.cpfResponsavel, '075.962.934-09')
  assert.equal(draft.valorMensal, '3.190,00')
  assert.equal(draft.valorParcela, 'R$ 3.190,00')
  assert.equal(draft.valorMensalExtenso, 'tres mil, cento e noventa reais')
  assert.equal(draft.diaVencimento, '28 (vinte e oito)')
  assert.equal(draft.vencimentoParcela1, 'Dia 28/04/2026')
  assert.equal(draft.dataContrato, '28 de abril de 2026')
  assert.equal(draft.cidadeContrato, 'Caruaru')
})

test('applyContractTemplate substitui placeholders e encontra pendencias restantes', () => {
  const draft = hydrateContractDraft({
    ...EMPTY_CONTRACT_DRAFT,
    nomeCliente: 'Cliente Teste LTDA',
    cnpjCliente: '11.222.333/0001-44',
    valorMensal: '2.500,00',
  })

  const text = applyContractTemplate('Empresa: {NOME_CLIENTE}\nCNPJ: {CNPJ_CLIENTE}\nMensal: {VALOR_MENSAL}\nPrazo: {NAO_MAPEADO}', draft)
  assert.match(text, /Cliente Teste LTDA/)
  assert.match(text, /11\.222\.333\/0001-44/)
  assert.match(text, /2\.500,00/)
  assert.match(text, /\{NAO_MAPEADO\}/)
})

test('completion, resumo e nome de arquivo refletem o contrato preenchido', () => {
  const draft = hydrateContractDraft({
    ...EMPTY_CONTRACT_DRAFT,
    nomeCliente: 'AWA Construcoes e Incorporacoes LTDA',
    cnpjCliente: '23.569.125/0001-32',
    enderecoCliente: 'Av. X, 800',
    telefoneCliente: '(81) 9836-9779',
    nomeResponsavel: 'Jose Alysson Miranda Leo',
    nacionalidade: 'brasileiro',
    estadoCivil: 'casado',
    profissao: 'engenheiro civil',
    rgResponsavel: '6.917.384-SDS/PE',
    cpfResponsavel: '075.962.934-09',
    enderecoResponsavel: 'Rua X, 265',
    plataformas: 'Meta Ads e Google Ads',
    valorMensal: '3.190,00',
    valorMinimoTrafego: '1.400,00',
    diaEmissaoNfSubsequente: '18 (dezoito)',
    diaVencimento: '28 (vinte e oito)',
    vencimentoParcela1: 'Dia 28/04/2026',
    vencimentoParcela2: 'Dia 28/05/2026',
    vencimentoParcela3: 'Dia 28/06/2026',
    dataContrato: '28 de abril de 2026',
    cidadeContrato: 'Caruaru',
  })

  assert.deepEqual(getMissingContractFields(draft), [])
  assert.equal(getContractCompletion(draft).percent, 100)
  assert.match(buildContractConfirmationSummary(draft), /EMPRESA: AWA Construcoes e Incorporacoes LTDA/)
  assert.equal(buildContractFileName(draft, new Date('2026-04-30T12:00:00Z')), 'Contrato_AWA_Construcoes_e_Incorporacoes_LTDA_NGP_04_2026')
})

test('isPositiveConfirmation reconhece confirmacoes diretas', () => {
  assert.equal(isPositiveConfirmation('sim'), true)
  assert.equal(isPositiveConfirmation('gera'), true)
  assert.equal(isPositiveConfirmation('ok'), true)
  assert.equal(isPositiveConfirmation('sim, pode gerar'), true)
  assert.equal(isPositiveConfirmation('tudo certo, pode seguir'), true)
  assert.equal(isPositiveConfirmation('nao pode gerar ainda'), false)
  assert.equal(isPositiveConfirmation('ajusta o cpf'), false)
})

test('buildContractMissingPrompt pede apenas o que falta no bloco atual', () => {
  const promptEmpresa = buildContractMissingPrompt(EMPTY_CONTRACT_DRAFT)
  assert.match(promptEmpresa, /empresa/i)
  assert.match(promptEmpresa, /razao social/i)
  assert.match(promptEmpresa, /cnpj/i)

  const partial = hydrateContractDraft({
    ...EMPTY_CONTRACT_DRAFT,
    nomeCliente: 'Cliente Teste LTDA',
    cnpjCliente: '11.222.333/0001-44',
    enderecoCliente: 'Rua A, 10',
    telefoneCliente: '(81) 99999-0000',
  })

  const promptResponsavel = buildContractMissingPrompt(partial)
  assert.match(promptResponsavel, /responsavel legal/i)
  assert.doesNotMatch(promptResponsavel, /empresa/i)
})

test('reconfirmacao mostra apenas os campos realmente alterados', () => {
  const previous = hydrateContractDraft({
    ...EMPTY_CONTRACT_DRAFT,
    nomeCliente: 'Cliente Teste LTDA',
    valorMensal: '3.000,00',
    nomeResponsavel: 'Joao Silva',
  })

  const next = mergeContractDraft(previous, {
    nomeResponsavel: 'Maria Silva',
    valorMensal: '3500',
  })

  const changed = getChangedContractFields(previous, next)
  const summary = buildContractChangeConfirmation(next, changed)

  assert.deepEqual(changed.includes('nomeResponsavel'), true)
  assert.deepEqual(changed.includes('valorMensal'), true)
  assert.match(summary, /Nome do responsavel: Maria Silva/)
  assert.match(summary, /Valor mensal: 3\.500,00/)
  assert.doesNotMatch(summary, /Valor mensal por extenso/)
})
