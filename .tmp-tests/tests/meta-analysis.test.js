"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const meta_analysis_1 = require("../lib/meta-analysis");
const currentCampaigns = [
    {
        id: 'c1',
        name: 'Campanha Escala',
        status: 'ACTIVE',
        objective: 'LEADS',
        spend: 300,
        impressions: 10000,
        clicks: 200,
        ctr: 2,
        cpc: 1.5,
        conversations: 30,
        leads: 25,
        purchases: 2,
        purchaseValue: 900,
        roas: 3,
        reach: 7000,
    },
    {
        id: 'c2',
        name: 'Campanha Gargalo',
        status: 'PAUSED',
        objective: 'LEADS',
        spend: 100,
        impressions: 8000,
        clicks: 5,
        ctr: 0.06,
        cpc: 20,
        conversations: 0,
        leads: 0,
        purchases: 0,
        purchaseValue: 0,
        roas: 0,
        reach: 5000,
    },
];
const previousCampaigns = [
    {
        id: 'p1',
        name: 'Periodo anterior',
        status: 'ACTIVE',
        objective: 'LEADS',
        spend: 250,
        impressions: 9000,
        clicks: 150,
        ctr: 1.66,
        cpc: 1.66,
        conversations: 8,
        leads: 18,
        purchases: 1,
        purchaseValue: 500,
        roas: 2,
        reach: 6500,
    },
];
(0, node_test_1.default)('buildMetaAnalysis consolida totais, deltas e sinais principais', () => {
    const analysis = (0, meta_analysis_1.buildMetaAnalysis)(currentCampaigns, previousCampaigns);
    strict_1.default.equal(analysis.current.spend, 400);
    strict_1.default.equal(analysis.current.primaryResults, 30);
    strict_1.default.equal(analysis.current.primaryResultLabel, 'Conversas');
    strict_1.default.equal(analysis.current.activeCampaigns, 1);
    strict_1.default.equal(analysis.current.pausedCampaigns, 1);
    strict_1.default.equal(analysis.previous?.spend, 250);
    strict_1.default.ok(analysis.deltas.spend !== null);
    strict_1.default.ok((analysis.deltas.spend || 0) > 0);
    strict_1.default.equal(analysis.topCampaigns[0]?.name, 'Campanha Escala');
    strict_1.default.equal(analysis.opportunity?.name, 'Campanha Escala');
    strict_1.default.equal(analysis.attention?.name, 'Campanha Gargalo');
    strict_1.default.ok(analysis.concentration.top1Share > 70);
    strict_1.default.match(analysis.headline, /clique|mensagem|renovacao|renovação|concentrad|domina|escalar/i);
});
