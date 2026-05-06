"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const analytics_snapshot_1 = require("../lib/analytics-snapshot");
const analytics_contract_1 = require("../lib/analytics-contract");
const period = {
    time_range: JSON.stringify({ since: '2026-04-17', until: '2026-04-23' }),
};
const campaigns = [
    {
        id: 'c1',
        name: 'Leads Meta',
        status: 'ACTIVE',
        objective: 'LEADS',
        spend: 420,
        impressions: 15000,
        clicks: 240,
        ctr: 1.6,
        cpc: 1.75,
        conversations: 18,
        leads: 11,
        purchases: 1,
        purchaseValue: 850,
        roas: 2.02,
        reach: 11000,
    },
    {
        id: 'c2',
        name: 'Topo de funil',
        status: 'ACTIVE',
        objective: 'TRAFFIC',
        spend: 180,
        impressions: 14000,
        clicks: 120,
        ctr: 0.86,
        cpc: 1.5,
        conversations: 0,
        leads: 0,
        purchases: 0,
        purchaseValue: 0,
        roas: 0,
        reach: 9000,
    },
];
const previousCampaigns = [
    {
        id: 'p1',
        name: 'Periodo anterior',
        status: 'ACTIVE',
        objective: 'LEADS',
        spend: 500,
        impressions: 12000,
        clicks: 200,
        ctr: 1.66,
        cpc: 2.5,
        conversations: 10,
        leads: 6,
        purchases: 1,
        purchaseValue: 600,
        roas: 1.2,
        reach: 8000,
    },
];
const creatives = [
    {
        id: 'a1',
        name: 'Criativo 1',
        status: 'ACTIVE',
        spend: 220,
        impressions: 9000,
        clicks: 140,
        ctr: 1.55,
        cpc: 1.57,
        conversations: 12,
        leads: 7,
        purchases: 1,
        purchaseValue: 600,
        roas: 2.72,
        reach: 7000,
    },
    {
        id: 'a2',
        name: 'Criativo 2',
        status: 'ACTIVE',
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cpc: 0,
        conversations: 0,
        leads: 0,
        purchases: 0,
        purchaseValue: 0,
        roas: 0,
        reach: 0,
    },
];
(0, node_test_1.default)('buildAnalyticsSnapshot gera snapshot canonico para IA e dashboard', () => {
    const snapshot = (0, analytics_snapshot_1.buildAnalyticsSnapshot)({
        client: {
            id: 'client-1',
            name: 'Solucione Energia',
            username: 'solucione',
            metaAccountId: '123456',
        },
        period: {
            label: '17/04/2026 a 23/04/2026',
            current: period,
            comparisonLabel: '10/04/2026 a 16/04/2026',
            comparison: period,
        },
        campaigns,
        prevCampaigns: previousCampaigns,
        creatives,
        selectedCampaignIds: ['c1'],
        monthlyAuthorizedBudget: 3000,
        generatedAt: '2026-04-26T12:00:00.000Z',
    });
    strict_1.default.equal(snapshot.schemaVersion, 3);
    strict_1.default.equal(snapshot.client.name, 'Solucione Energia');
    strict_1.default.equal(snapshot.summary.spend, 600);
    strict_1.default.equal(snapshot.summary.primaryResultLabel, 'Conversas');
    strict_1.default.equal(snapshot.summary.filteredCampaignCount, 2);
    strict_1.default.equal(snapshot.filters.selectedCampaignIds.length, 1);
    strict_1.default.equal(snapshot.creatives.length, 1);
    strict_1.default.ok(snapshot.summary.periodAuthorizedBudget > 0);
    strict_1.default.ok(snapshot.summary.budgetUsagePercent > 0);
    strict_1.default.ok(snapshot.comparison?.deltas.cpc !== null);
    strict_1.default.equal(snapshot.diagnosis.signals.length, 5);
    const display = (0, analytics_snapshot_1.summarizeSnapshotForDisplay)(snapshot);
    strict_1.default.ok(display.spendDelta !== null);
    strict_1.default.ok(display.ctrDelta !== null);
});
(0, node_test_1.default)('structured analysis contract parses and renders deterministic markdown', () => {
    const parsed = (0, analytics_contract_1.parseStructuredAnalysis)({
        version: 1,
        headline: 'Conta com margem para escalar',
        diagnosis: 'CTR sustentado e CPC controlado no periodo analisado.',
        wins: ['Campanha principal sustentou o volume com eficiencia.'],
        risks: ['Dependencia elevada de uma unica campanha.'],
        opportunities: ['Redistribuir verba para criativos com melhor CTR.'],
        nextActions: [
            {
                title: 'Escalar campanha principal',
                detail: 'Aumentar verba gradualmente e monitorar frequencia.',
                priority: 'high',
            },
        ],
        dataGaps: ['Breakdown por placement ainda nao consolidado.'],
        confidence: 'medium',
    });
    strict_1.default.ok(parsed);
    const markdown = (0, analytics_contract_1.renderStructuredAnalysisMarkdown)(parsed);
    strict_1.default.match(markdown, /Conta com margem para escalar/);
    strict_1.default.match(markdown, /Proximas acoes|Próximas ações/i);
});
