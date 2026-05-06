"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCampaignPrimaryResult = getCampaignPrimaryResult;
exports.getCampaignPrimaryResultLabel = getCampaignPrimaryResultLabel;
exports.buildMetaAnalysis = buildMetaAnalysis;
function pctChange(current, previous) {
    if (!Number.isFinite(previous) || previous <= 0)
        return null;
    return ((current - previous) / previous) * 100;
}
function getCampaignPrimaryResult(campaign) {
    return campaign.conversations || campaign.leads || campaign.purchases || 0;
}
function getCampaignPrimaryResultLabel(campaign) {
    if (campaign.conversations > 0)
        return 'Conversas';
    if (campaign.leads > 0)
        return 'Leads';
    if (campaign.purchases > 0)
        return 'Compras';
    return 'Resultados';
}
function buildTotals(campaigns) {
    const spend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
    const impressions = campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);
    const clicks = campaigns.reduce((sum, campaign) => sum + campaign.clicks, 0);
    const reach = campaigns.reduce((sum, campaign) => sum + campaign.reach, 0);
    const conversations = campaigns.reduce((sum, campaign) => sum + campaign.conversations, 0);
    const leads = campaigns.reduce((sum, campaign) => sum + campaign.leads, 0);
    const purchases = campaigns.reduce((sum, campaign) => sum + campaign.purchases, 0);
    const revenue = campaigns.reduce((sum, campaign) => sum + campaign.purchaseValue, 0);
    const primaryResults = campaigns.reduce((sum, campaign) => sum + getCampaignPrimaryResult(campaign), 0);
    const primaryResultLabel = conversations > 0 ? 'Conversas' : leads > 0 ? 'Leads' : purchases > 0 ? 'Compras' : 'Resultados';
    return {
        spend,
        impressions,
        clicks,
        reach,
        conversations,
        leads,
        purchases,
        revenue,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        roas: spend > 0 ? revenue / spend : 0,
        frequency: reach > 0 ? impressions / reach : 0,
        costPerLead: leads > 0 ? spend / leads : 0,
        costPerPurchase: purchases > 0 ? spend / purchases : 0,
        costPerResult: primaryResults > 0 ? spend / primaryResults : 0,
        conversionRate: clicks > 0 ? (primaryResults / clicks) * 100 : 0,
        primaryResults,
        primaryResultLabel,
        activeCampaigns: campaigns.filter((campaign) => campaign.status === 'ACTIVE').length,
        pausedCampaigns: campaigns.filter((campaign) => campaign.status !== 'ACTIVE').length,
        campaignCount: campaigns.length,
    };
}
function buildCampaignSummary(campaign, totalSpend) {
    const primaryResults = getCampaignPrimaryResult(campaign);
    const efficiencyScore = campaign.spend > 0
        ? primaryResults > 0
            ? primaryResults / campaign.spend
            : campaign.clicks / campaign.spend
        : 0;
    return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        spend: campaign.spend,
        spendShare: totalSpend > 0 ? (campaign.spend / totalSpend) * 100 : 0,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        ctr: campaign.ctr,
        cpc: campaign.cpc,
        reach: campaign.reach,
        frequency: campaign.reach > 0 ? campaign.impressions / campaign.reach : 0,
        conversations: campaign.conversations,
        leads: campaign.leads,
        purchases: campaign.purchases,
        roas: campaign.roas,
        revenue: campaign.purchaseValue,
        primaryResults,
        primaryResultLabel: getCampaignPrimaryResultLabel(campaign),
        costPerLead: campaign.leads > 0 ? campaign.spend / campaign.leads : null,
        costPerResult: primaryResults > 0 ? campaign.spend / primaryResults : null,
        efficiencyScore,
    };
}
function buildHeadline(current, previous, dominantCampaign, top3Share, opportunity) {
    if (previous &&
        previous.spend > 0 &&
        previous.primaryResults > 0 &&
        current.spend > previous.spend &&
        current.primaryResults < previous.primaryResults) {
        return 'O investimento aumentou, mas o resultado principal caiu. Vale revisar segmentação, verba e desgaste de criativos.';
    }
    if (previous &&
        previous.ctr > 0 &&
        previous.cpc > 0 &&
        current.ctr < previous.ctr &&
        current.cpc > previous.cpc) {
        return 'O clique ficou mais caro enquanto a taxa de cliques cedeu. O período pede ajuste de mensagem ou renovação criativa.';
    }
    if (current.frequency >= 3.2) {
        return 'A frequência está alta para o volume de alcance. Há sinal de saturação em parte da audiência.';
    }
    if (top3Share >= 75) {
        return 'A verba está concentrada em poucas campanhas. Existe eficiência, mas também dependência elevada de um núcleo só.';
    }
    if (dominantCampaign && dominantCampaign.spendShare >= 40) {
        return `A campanha ${dominantCampaign.name} domina boa parte do investimento e merece monitoramento mais próximo.`;
    }
    if (opportunity && opportunity.primaryResults > 0) {
        return `Existe espaço para escalar ${opportunity.name}, que hoje aparece como a melhor oportunidade do recorte.`;
    }
    return 'O recorte está equilibrado, com margem para otimizar distribuição de verba, eficiência de clique e conversão.';
}
function buildMetaAnalysis(campaigns, prevCampaigns = []) {
    const current = buildTotals(campaigns);
    const previous = prevCampaigns.length > 0 ? buildTotals(prevCampaigns) : null;
    const topCampaigns = campaigns
        .map((campaign) => buildCampaignSummary(campaign, current.spend))
        .sort((left, right) => right.spend - left.spend);
    const campaignsWithSpend = topCampaigns.filter((campaign) => campaign.spend > 0);
    const dominantCampaign = topCampaigns[0] || null;
    const top1Share = dominantCampaign?.spendShare || 0;
    const top3Share = current.spend > 0
        ? topCampaigns.slice(0, 3).reduce((sum, campaign) => sum + campaign.spend, 0) / current.spend * 100
        : 0;
    const opportunity = campaignsWithSpend
        .slice()
        .sort((left, right) => right.efficiencyScore - left.efficiencyScore || right.spend - left.spend)[0] || null;
    const attention = campaignsWithSpend
        .slice()
        .sort((left, right) => {
        if (left.primaryResults === 0 && right.primaryResults > 0)
            return -1;
        if (right.primaryResults === 0 && left.primaryResults > 0)
            return 1;
        return left.efficiencyScore - right.efficiencyScore || right.spend - left.spend;
    })[0] || null;
    return {
        current,
        previous,
        deltas: {
            spend: previous ? pctChange(current.spend, previous.spend) : null,
            impressions: previous ? pctChange(current.impressions, previous.impressions) : null,
            clicks: previous ? pctChange(current.clicks, previous.clicks) : null,
            ctr: previous ? pctChange(current.ctr, previous.ctr) : null,
            cpc: previous ? pctChange(current.cpc, previous.cpc) : null,
            cpm: previous ? pctChange(current.cpm, previous.cpm) : null,
            reach: previous ? pctChange(current.reach, previous.reach) : null,
            frequency: previous ? pctChange(current.frequency, previous.frequency) : null,
            conversations: previous ? pctChange(current.conversations, previous.conversations) : null,
            leads: previous ? pctChange(current.leads, previous.leads) : null,
            purchases: previous ? pctChange(current.purchases, previous.purchases) : null,
            costPerLead: previous ? pctChange(current.costPerLead, previous.costPerLead) : null,
            costPerResult: previous ? pctChange(current.costPerResult, previous.costPerResult) : null,
            conversionRate: previous ? pctChange(current.conversionRate, previous.conversionRate) : null,
            roas: previous ? pctChange(current.roas, previous.roas) : null,
        },
        topCampaigns,
        opportunity,
        attention,
        concentration: {
            top1Share,
            top3Share,
            dominantCampaign,
        },
        headline: buildHeadline(current, previous, dominantCampaign, top3Share, opportunity),
    };
}
