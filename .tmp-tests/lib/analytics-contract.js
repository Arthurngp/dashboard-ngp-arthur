"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStructuredAnalysis = parseStructuredAnalysis;
exports.renderStructuredAnalysisMarkdown = renderStructuredAnalysisMarkdown;
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}
function asPriority(value) {
    if (value === 'high' || value === 'medium' || value === 'low')
        return value;
    return 'medium';
}
function asConfidence(value) {
    if (value === 'high' || value === 'medium' || value === 'low')
        return value;
    return 'medium';
}
function parseStructuredAnalysis(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    const headline = String(source.headline || '').trim();
    const diagnosis = String(source.diagnosis || '').trim();
    if (!headline || !diagnosis)
        return null;
    const rawActions = Array.isArray(source.nextActions) ? source.nextActions : [];
    const nextActions = rawActions
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const action = item;
        const title = String(action.title || '').trim();
        const detail = String(action.detail || '').trim();
        if (!title || !detail)
            return null;
        return {
            title,
            detail,
            priority: asPriority(action.priority),
        };
    })
        .filter((item) => item !== null);
    return {
        version: 1,
        headline,
        diagnosis,
        wins: asStringArray(source.wins),
        risks: asStringArray(source.risks),
        opportunities: asStringArray(source.opportunities),
        nextActions,
        dataGaps: asStringArray(source.dataGaps),
        confidence: asConfidence(source.confidence),
    };
}
function renderStructuredAnalysisMarkdown(result) {
    const sections = [
        `# ${result.headline}`,
        '',
        result.diagnosis,
    ];
    const listSection = (title, items) => {
        if (!items.length)
            return;
        sections.push('', `## ${title}`);
        items.forEach((item) => sections.push(`- ${item}`));
    };
    listSection('O que está funcionando', result.wins);
    listSection('Riscos e desperdícios', result.risks);
    listSection('Oportunidades', result.opportunities);
    if (result.nextActions.length) {
        sections.push('', '## Próximas ações');
        result.nextActions.forEach((action) => {
            sections.push(`- [${action.priority.toUpperCase()}] ${action.title}: ${action.detail}`);
        });
    }
    listSection('Lacunas de dados', result.dataGaps);
    sections.push('', `Confiança da análise: ${result.confidence}.`);
    return sections.join('\n');
}
