"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const contracts_1 = require("../lib/contracts");
(0, node_test_1.default)('mergeContractDraft normaliza campos essenciais e hidrata derivados', () => {
    const draft = (0, contracts_1.mergeContractDraft)(contracts_1.EMPTY_CONTRACT_DRAFT, {
        nomeCliente: 'AWA Construcoes e Incorporacoes LTDA',
        cnpjCliente: '23569125000132',
        telefoneCliente: '8198369779',
        cpfResponsavel: '07596293409',
        valorMensal: '3190',
        diaVencimento: '28',
        vencimentoParcela1: '2026-04-28',
        dataContrato: '2026-04-28',
        cidadeContrato: 'caruaru',
    });
    strict_1.default.equal(draft.cnpjCliente, '23.569.125/0001-32');
    strict_1.default.equal(draft.telefoneCliente, '(81) 9836-9779');
    strict_1.default.equal(draft.cpfResponsavel, '075.962.934-09');
    strict_1.default.equal(draft.valorMensal, '3.190,00');
    strict_1.default.equal(draft.valorParcela, 'R$ 3.190,00');
    strict_1.default.equal(draft.valorMensalExtenso, 'tres mil, cento e noventa reais');
    strict_1.default.equal(draft.diaVencimento, '28 (vinte e oito)');
    strict_1.default.equal(draft.vencimentoParcela1, 'Dia 28/04/2026');
    strict_1.default.equal(draft.dataContrato, '28 de abril de 2026');
    strict_1.default.equal(draft.cidadeContrato, 'Caruaru');
});
(0, node_test_1.default)('applyContractTemplate substitui placeholders e encontra pendencias restantes', () => {
    const draft = (0, contracts_1.hydrateContractDraft)({
        ...contracts_1.EMPTY_CONTRACT_DRAFT,
        nomeCliente: 'Cliente Teste LTDA',
        cnpjCliente: '11.222.333/0001-44',
        valorMensal: '2.500,00',
    });
    const text = (0, contracts_1.applyContractTemplate)('Empresa: {NOME_CLIENTE}\nCNPJ: {CNPJ_CLIENTE}\nMensal: {VALOR_MENSAL}\nPrazo: {NAO_MAPEADO}', draft);
    strict_1.default.match(text, /Cliente Teste LTDA/);
    strict_1.default.match(text, /11\.222\.333\/0001-44/);
    strict_1.default.match(text, /2\.500,00/);
    strict_1.default.match(text, /\{NAO_MAPEADO\}/);
});
(0, node_test_1.default)('completion, resumo e nome de arquivo refletem o contrato preenchido', () => {
    const draft = (0, contracts_1.hydrateContractDraft)({
        ...contracts_1.EMPTY_CONTRACT_DRAFT,
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
    });
    strict_1.default.deepEqual((0, contracts_1.getMissingContractFields)(draft), []);
    strict_1.default.equal((0, contracts_1.getContractCompletion)(draft).percent, 100);
    strict_1.default.match((0, contracts_1.buildContractConfirmationSummary)(draft), /EMPRESA: AWA Construcoes e Incorporacoes LTDA/);
    strict_1.default.equal((0, contracts_1.buildContractFileName)(draft, new Date('2026-04-30T12:00:00Z')), 'Contrato_AWA_Construcoes_e_Incorporacoes_LTDA_NGP_04_2026');
});
(0, node_test_1.default)('isPositiveConfirmation reconhece confirmacoes diretas', () => {
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('sim'), true);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('gera'), true);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('ok'), true);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('sim, pode gerar'), true);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('tudo certo, pode seguir'), true);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('nao pode gerar ainda'), false);
    strict_1.default.equal((0, contracts_1.isPositiveConfirmation)('ajusta o cpf'), false);
});
(0, node_test_1.default)('buildContractMissingPrompt pede apenas o que falta no bloco atual', () => {
    const promptEmpresa = (0, contracts_1.buildContractMissingPrompt)(contracts_1.EMPTY_CONTRACT_DRAFT);
    strict_1.default.match(promptEmpresa, /empresa/i);
    strict_1.default.match(promptEmpresa, /razao social/i);
    strict_1.default.match(promptEmpresa, /cnpj/i);
    const partial = (0, contracts_1.hydrateContractDraft)({
        ...contracts_1.EMPTY_CONTRACT_DRAFT,
        nomeCliente: 'Cliente Teste LTDA',
        cnpjCliente: '11.222.333/0001-44',
        enderecoCliente: 'Rua A, 10',
        telefoneCliente: '(81) 99999-0000',
    });
    const promptResponsavel = (0, contracts_1.buildContractMissingPrompt)(partial);
    strict_1.default.match(promptResponsavel, /responsavel legal/i);
    strict_1.default.doesNotMatch(promptResponsavel, /empresa/i);
});
(0, node_test_1.default)('reconfirmacao mostra apenas os campos realmente alterados', () => {
    const previous = (0, contracts_1.hydrateContractDraft)({
        ...contracts_1.EMPTY_CONTRACT_DRAFT,
        nomeCliente: 'Cliente Teste LTDA',
        valorMensal: '3.000,00',
        nomeResponsavel: 'Joao Silva',
    });
    const next = (0, contracts_1.mergeContractDraft)(previous, {
        nomeResponsavel: 'Maria Silva',
        valorMensal: '3500',
    });
    const changed = (0, contracts_1.getChangedContractFields)(previous, next);
    const summary = (0, contracts_1.buildContractChangeConfirmation)(next, changed);
    strict_1.default.deepEqual(changed.includes('nomeResponsavel'), true);
    strict_1.default.deepEqual(changed.includes('valorMensal'), true);
    strict_1.default.match(summary, /Nome do responsavel: Maria Silva/);
    strict_1.default.match(summary, /Valor mensal: 3\.500,00/);
    strict_1.default.doesNotMatch(summary, /Valor mensal por extenso/);
});
