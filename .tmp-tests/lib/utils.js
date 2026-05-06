"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = exports.fmtI = exports.fmtN = exports.fmt = void 0;
exports.parseIns = parseIns;
const meta_metrics_1 = require("./meta-metrics");
const fmt = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
exports.fmt = fmt;
const fmtN = (n) => parseInt(String(n || 0)).toLocaleString('pt-BR');
exports.fmtN = fmtN;
const fmtI = (n) => {
    n = parseInt(String(n || 0));
    return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
};
exports.fmtI = fmtI;
const esc = (s) => s == null
    ? ''
    : String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
exports.esc = esc;
function parseIns(ins) {
    if (!ins)
        return null;
    const actions = ins.actions || [];
    const av = ins.action_values || [];
    const spend = parseFloat(String(ins.spend || 0));
    const purVal = parseFloat(av.find((a) => a.action_type === 'purchase')?.value || '0');
    const roasArr = ins.purchase_roas || [];
    let roas = roasArr.length ? parseFloat(roasArr[0].value) : 0;
    if (!roas && purVal > 0 && spend > 0)
        roas = purVal / spend;
    const parsed = {};
    // Extrair valores diretamente da API ou das Actions
    meta_metrics_1.META_METRICS.forEach(metric => {
        let val = 0;
        if (metric.isAction) {
            if (metric.actionType === 'purchase_value') {
                val = purVal;
            }
            else {
                // Find action
                const actionMatch = actions.find(a => {
                    if (metric.actionType === 'messaging_conversation_started_7d') {
                        return a.action_type?.includes('messaging_conversation_started') || a.action_type?.includes('total_messaging');
                    }
                    if (metric.actionType === 'lead') {
                        return a.action_type === 'lead' || a.action_type === 'leadgen_grouped';
                    }
                    return a.action_type === metric.actionType;
                });
                val = parseFloat(actionMatch?.value || '0');
            }
        }
        else if (metric.apiField) {
            if (metric.apiField === 'purchase_roas') {
                val = roas;
            }
            else {
                val = parseFloat(String(ins[metric.apiField] || 0));
            }
        }
        parsed[metric.id] = val;
    });
    // Calcular custos derivados
    const calcCost = (eventId) => {
        const evts = parsed[eventId] || 0;
        return evts > 0 ? spend / evts : 0;
    };
    parsed['cost_per_view_content'] = calcCost('view_content');
    parsed['cost_per_add_to_cart'] = calcCost('add_to_cart');
    parsed['cost_per_checkout'] = calcCost('initiate_checkout');
    parsed['cost_per_purchase'] = calcCost('purchases');
    parsed['cost_per_lead'] = calcCost('leads');
    parsed['cost_per_conversation'] = calcCost('conversations');
    // Maintain legacy compatibility for existing codebase
    return {
        ...parsed,
        spend,
        impressions: parsed.impressions || 0,
        clicks: parsed.clicks || 0,
        ctr: parsed.ctr || 0,
        cpc: parsed.cpc || 0,
        reach: parsed.reach || 0,
        conversations: parsed.conversations || 0,
        leads: parsed.leads || 0,
        purchases: parsed.purchases || 0,
        purchaseValue: purVal,
        roas: parseFloat(roas.toFixed(2)),
    };
}
