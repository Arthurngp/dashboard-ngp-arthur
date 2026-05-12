"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const financeiro_agent_1 = require("../lib/financeiro-agent");
(0, node_test_1.default)('detectFinanceiroAgentIntent identifica pedidos comuns do financeiro', () => {
    strict_1.default.equal((0, financeiro_agent_1.detectFinanceiroAgentIntent)('quais riscos de atraso temos?'), 'risks');
    strict_1.default.equal((0, financeiro_agent_1.detectFinanceiroAgentIntent)('monta uma previsão de caixa'), 'forecast');
    strict_1.default.equal((0, financeiro_agent_1.detectFinanceiroAgentIntent)('revisar categorias sem centro de custo'), 'categorization');
    strict_1.default.equal((0, financeiro_agent_1.detectFinanceiroAgentIntent)('me dá um resumo do mês'), 'briefing');
});
(0, node_test_1.default)('buildFinanceiroAgentPeriod usa periodo informado quando valido', () => {
    const period = (0, financeiro_agent_1.buildFinanceiroAgentPeriod)(new Date('2026-05-03T12:00:00Z'), {
        start: '2026-04-01',
        end: '2026-04-30',
        label: 'Abril',
    });
    strict_1.default.deepEqual(period, { start: '2026-04-01', end: '2026-04-30', label: 'Abril' });
});
(0, node_test_1.default)('buildFinanceiroAgentPeriod cai para mes atual quando periodo e invalido', () => {
    const period = (0, financeiro_agent_1.buildFinanceiroAgentPeriod)(new Date('2026-05-03T12:00:00Z'), {
        start: '2026-05-31',
        end: '2026-05-01',
    });
    strict_1.default.deepEqual(period, { start: '2026-05-01', end: '2026-05-31', label: 'Mês atual' });
});
(0, node_test_1.default)('summarizeFinanceiroAgentTotals separa realizado e pendente', () => {
    const totals = (0, financeiro_agent_1.summarizeFinanceiroAgentTotals)([
        { tipo: 'entrada', valor: 1000, status: 'confirmado' },
        { tipo: 'entrada', valor: '500', status: 'pendente' },
        { tipo: 'saida', valor: 300, status: 'confirmado' },
        { tipo: 'saida', valor: '200', status: 'pendente' },
    ]);
    strict_1.default.deepEqual(totals, {
        entradas: 1000,
        saidas: 300,
        saldo: 700,
        pendenteEntrada: 500,
        pendenteSaida: 200,
    });
});
(0, node_test_1.default)('buildFinanceiroAgentFallback prioriza pendencias e saldo negativo', () => {
    const actions = (0, financeiro_agent_1.buildFinanceiroAgentFallback)({
        entradas: 100,
        saidas: 300,
        saldo: -200,
        pendenteEntrada: 50,
        pendenteSaida: 20,
    });
    strict_1.default.equal(actions.length, 3);
    strict_1.default.match(actions.join(' '), /entradas pendentes/);
    strict_1.default.match(actions.join(' '), /despesas pendentes/);
    strict_1.default.match(actions.join(' '), /negativo/);
});
