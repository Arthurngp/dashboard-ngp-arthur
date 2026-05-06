"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFinanceiroAgentIntent = detectFinanceiroAgentIntent;
exports.buildFinanceiroAgentPeriod = buildFinanceiroAgentPeriod;
exports.summarizeFinanceiroAgentTotals = summarizeFinanceiroAgentTotals;
exports.buildFinanceiroAgentFallback = buildFinanceiroAgentFallback;
function detectFinanceiroAgentIntent(message) {
    const normalized = normalizeText(message);
    if (!normalized)
        return 'briefing';
    if (containsAny(normalized, ['risco', 'alerta', 'atraso', 'vencid', 'inadimpl', 'problema'])) {
        return 'risks';
    }
    if (containsAny(normalized, ['previs', 'projec', 'forecast', 'tendencia', 'tendencia'])) {
        return 'forecast';
    }
    if (containsAny(normalized, ['caixa', 'saldo', 'fluxo', 'cashflow', 'cash flow'])) {
        return 'cashflow';
    }
    if (containsAny(normalized, ['categoria', 'categorizar', 'classifica', 'centro de custo'])) {
        return 'categorization';
    }
    if (containsAny(normalized, ['briefing', 'resumo', 'painel', 'diagnostico', 'diagnostico'])) {
        return 'briefing';
    }
    return 'unknown';
}
function buildFinanceiroAgentPeriod(now, input) {
    const inputStart = normalizeDateOnly(input?.start);
    const inputEnd = normalizeDateOnly(input?.end);
    if (inputStart && inputEnd && inputStart <= inputEnd) {
        return {
            start: inputStart,
            end: inputEnd,
            label: input?.label?.trim() || `${inputStart} a ${inputEnd}`,
        };
    }
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = formatDateOnly(new Date(Date.UTC(year, month, 1)));
    const end = formatDateOnly(new Date(Date.UTC(year, month + 1, 0)));
    return { start, end, label: 'Mês atual' };
}
function summarizeFinanceiroAgentTotals(rows) {
    return rows.reduce((acc, row) => {
        const value = Math.abs(Number(row.valor || 0));
        if (!Number.isFinite(value))
            return acc;
        if (row.tipo === 'entrada') {
            if (row.status === 'pendente')
                acc.pendenteEntrada += value;
            else
                acc.entradas += value;
        }
        else if (row.tipo === 'saida') {
            if (row.status === 'pendente')
                acc.pendenteSaida += value;
            else
                acc.saidas += value;
        }
        acc.saldo = acc.entradas - acc.saidas;
        return acc;
    }, { entradas: 0, saidas: 0, saldo: 0, pendenteEntrada: 0, pendenteSaida: 0 });
}
function buildFinanceiroAgentFallback(totals) {
    const actions = [];
    if (totals.pendenteEntrada > 0) {
        actions.push('Revisar entradas pendentes e priorizar cobranças com maior valor.');
    }
    if (totals.pendenteSaida > 0) {
        actions.push('Conferir despesas pendentes antes de comprometer o saldo projetado.');
    }
    if (totals.saldo < 0) {
        actions.push('Montar plano de contenção para o período, porque o realizado está negativo.');
    }
    if (actions.length === 0) {
        actions.push('Acompanhar lançamentos novos e manter categorias, contatos e contas conciliados.');
    }
    return actions;
}
function containsAny(value, terms) {
    return terms.some(term => value.includes(term));
}
function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
function normalizeDateOnly(value) {
    if (typeof value !== 'string')
        return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function formatDateOnly(date) {
    return date.toISOString().slice(0, 10);
}
