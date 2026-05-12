"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAnalyticsSnapshot = buildAnalyticsSnapshot;
exports.summarizeSnapshotForDisplay = summarizeSnapshotForDisplay;
const meta_analysis_1 = require("./meta-analysis");
function pctChange(current, previous) {
    if (!Number.isFinite(previous) || previous <= 0)
        return null;
    return ((current - previous) / previous) * 100;
}
function toneFromDelta(delta, lowerIsBetter = false) {
    if (delta === null || !Number.isFinite(delta))
        return 'neutral';
    if (delta === 0)
        return 'neutral';
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    if (improved)
        return 'good';
    return Math.abs(delta) >= 15 ? 'bad' : 'warn';
}
function getPeriodBudgetFactor(dp) {
    if (dp.time_range) {
        try {
            const range = JSON.parse(dp.time_range);
            if (range.since && range.until) {
                const since = new Date(`${range.since}T00:00:00`);
                const until = new Date(`${range.until}T00:00:00`);
                const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000) + 1);
                return days / 30;
            }
        }
        catch {
            return 1;
        }
    }
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    switch (dp.date_preset) {
        case 'today':
        case 'yesterday':
            return 1 / 30;
        case 'last_7d':
            return 7 / 30;
        case 'last_90d':
            return 90 / 30;
        case 'this_month':
            return now.getDate() / daysInMonth;
        case 'last_month':
        case 'last_30d':
        default:
            return 1;
    }
}
function formatSignedPct(delta) {
    if (delta === null || !Number.isFinite(delta))
        return null;
    const signal = delta > 0 ? '+' : '';
    return `${signal}${delta.toFixed(1)}%`;
}
function buildAnalyticsSnapshot({ client, period, campaigns, prevCampaigns = [], creatives = [], selectedCampaignIds = [], monthlyAuthorizedBudget = 0, generatedAt = new Date().toISOString(), }) {
    const analysis = (0, meta_analysis_1.buildMetaAnalysis)(campaigns, prevCampaigns);
    const { current, previous, deltas, topCampaigns, opportunity, attention, concentration, headline } = analysis;
    const budgetFactor = getPeriodBudgetFactor(period.current);
    const periodAuthorizedBudget = monthlyAuthorizedBudget > 0 ? monthlyAuthorizedBudget * budgetFactor : 0;
    const budgetBalance = periodAuthorizedBudget - current.spend;
    const budgetUsagePercent = periodAuthorizedBudget > 0 ? (current.spend / periodAuthorizedBudget) * 100 : 0;
    const diagnosisSignals = [
        {
            title: 'Melhor oportunidade',
            value: opportunity ? opportunity.name : 'Sem oportunidade clara',
            detail: opportunity
                ? `${opportunity.primaryResults} ${opportunity.primaryResultLabel.toLowerCase()} com R$ ${opportunity.spend.toFixed(2)} investidos e ${opportunity.spendShare.toFixed(1)}% da verba.`
                : 'Ainda não há volume suficiente para destacar uma campanha com segurança.',
            tone: opportunity && opportunity.primaryResults > 0 ? 'good' : 'neutral',
        },
        {
            title: 'Ponto de atenção',
            value: attention ? attention.name : 'Sem alerta relevante',
            detail: attention
                ? `${attention.primaryResults > 0 ? `${attention.primaryResults} ${attention.primaryResultLabel.toLowerCase()}` : 'Sem resultado principal'} · R$ ${attention.spend.toFixed(2)} investidos · frequência ${attention.frequency.toFixed(2)}x.`
                : 'Nenhuma campanha com gasto relevante apareceu como gargalo importante neste período.',
            tone: attention && attention.primaryResults === 0 && attention.spend > 0
                ? 'bad'
                : attention && attention.frequency >= 3.2
                    ? 'warn'
                    : 'neutral',
        },
        {
            title: 'Concentração de verba',
            value: `${concentration.top1Share.toFixed(1)}% na principal campanha`,
            detail: concentration.dominantCampaign
                ? `${concentration.dominantCampaign.name} lidera o recorte. As 3 maiores campanhas concentram ${concentration.top3Share.toFixed(1)}% do investimento.`
                : 'Ainda não há verba suficiente distribuída para medir concentração com clareza.',
            tone: concentration.top3Share >= 75
                ? 'bad'
                : concentration.top3Share >= 55
                    ? 'warn'
                    : 'good',
        },
        {
            title: 'Ritmo de investimento',
            value: periodAuthorizedBudget > 0 ? `${budgetUsagePercent.toFixed(1)}% da verba prevista` : 'Sem verba prevista',
            detail: periodAuthorizedBudget > 0
                ? `Saldo projetado do período: R$ ${budgetBalance.toFixed(2)}.`
                : 'Nenhum investimento autorizado para o período foi cadastrado.',
            tone: periodAuthorizedBudget <= 0
                ? 'neutral'
                : budgetBalance < 0
                    ? 'bad'
                    : budgetUsagePercent >= 85
                        ? 'warn'
                        : 'good',
        },
        {
            title: 'Eficiência de clique',
            value: `${current.ctr.toFixed(2)}% CTR · R$ ${current.cpc.toFixed(2)} CPC`,
            detail: current.frequency >= 3.2
                ? `Frequência em ${current.frequency.toFixed(2)}x, com risco de saturação.`
                : `Conversão em ${current.conversionRate.toFixed(2)}% do clique para ${current.primaryResultLabel.toLowerCase()}.`,
            tone: toneFromDelta(deltas.ctr, false) === 'bad' && toneFromDelta(deltas.cpc, true) === 'bad'
                ? 'bad'
                : toneFromDelta(deltas.ctr, false) === 'good' || toneFromDelta(deltas.cpc, true) === 'good'
                    ? 'good'
                    : 'warn',
        },
    ];
    const comparison = previous
        ? {
            spend: previous.spend,
            revenue: previous.revenue,
            roas: previous.roas,
            cpc: previous.cpc,
            cpm: previous.cpm,
            costPerResult: previous.costPerResult,
            primaryResults: previous.primaryResults,
            ctr: previous.ctr,
            frequency: previous.frequency,
            conversionRate: previous.conversionRate,
            deltas: {
                spend: deltas.spend,
                primaryResults: pctChange(current.primaryResults, previous.primaryResults),
                ctr: deltas.ctr,
                cpc: deltas.cpc,
                frequency: deltas.frequency,
                roas: deltas.roas,
                conversionRate: deltas.conversionRate,
            },
        }
        : null;
    return {
        schemaVersion: 3,
        source: 'dashboard_meta_ads',
        generatedAt,
        client,
        period: {
            label: period.label,
            current: period.current,
            comparisonLabel: period.comparisonLabel || null,
            comparison: period.comparison || null,
        },
        summary: {
            spend: current.spend,
            revenue: current.revenue,
            roas: current.roas,
            cpc: current.cpc,
            cpm: current.cpm,
            costPerResult: current.costPerResult,
            primaryResultLabel: current.primaryResultLabel,
            primaryResults: current.primaryResults,
            conversations: current.conversations,
            leads: current.leads,
            purchases: current.purchases,
            impressions: current.impressions,
            clicks: current.clicks,
            ctr: current.ctr,
            reach: current.reach,
            frequency: current.frequency,
            conversionRate: current.conversionRate,
            campaignCount: current.campaignCount,
            filteredCampaignCount: campaigns.length,
            monthlyAuthorizedBudget,
            periodAuthorizedBudget,
            budgetBalance,
            budgetUsagePercent,
        },
        comparison,
        diagnosis: {
            headline,
            signals: diagnosisSignals,
        },
        campaigns: topCampaigns.slice(0, 20).map((campaign, index) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            spendRank: index + 1,
            spend: campaign.spend,
            spendShare: campaign.spendShare,
            impressions: campaign.impressions,
            clicks: campaign.clicks,
            ctr: campaign.ctr,
            cpc: campaign.cpc,
            reach: campaign.reach,
            conversations: campaign.conversations,
            leads: campaign.leads,
            purchases: campaign.purchases,
            primaryResults: campaign.primaryResults,
            primaryResultLabel: campaign.primaryResultLabel,
            costPerResult: campaign.costPerResult,
            roas: campaign.roas,
            revenue: campaign.revenue,
        })),
        creatives: creatives
            .filter((creative) => creative.spend > 0 || creative.clicks > 0 || creative.impressions > 0)
            .sort((left, right) => right.spend - left.spend)
            .slice(0, 20)
            .map((creative, index) => ({
            id: creative.id,
            name: creative.name,
            status: creative.status,
            spendRank: index + 1,
            spend: creative.spend,
            impressions: creative.impressions,
            clicks: creative.clicks,
            ctr: creative.ctr,
            cpc: creative.clicks > 0 ? creative.spend / creative.clicks : null,
        })),
        filters: {
            selectedCampaignIds,
        },
    };
}
function summarizeSnapshotForDisplay(snapshot) {
    return {
        periodLabel: snapshot.period.label,
        comparisonLabel: snapshot.period.comparisonLabel,
        spendDelta: snapshot.comparison ? formatSignedPct(snapshot.comparison.deltas.spend) : null,
        resultsDelta: snapshot.comparison ? formatSignedPct(snapshot.comparison.deltas.primaryResults) : null,
        ctrDelta: snapshot.comparison ? formatSignedPct(snapshot.comparison.deltas.ctr) : null,
        cpcDelta: snapshot.comparison ? formatSignedPct(snapshot.comparison.deltas.cpc) : null,
        frequencyDelta: snapshot.comparison ? formatSignedPct(snapshot.comparison.deltas.frequency) : null,
    };
}
