"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const utils_1 = require("../lib/utils");
(0, node_test_1.default)('parseIns normaliza insights da Meta e calcula ROAS fallback', () => {
    const parsed = (0, utils_1.parseIns)({
        spend: '250.50',
        impressions: '10000',
        clicks: '200',
        ctr: '2',
        cpc: '1.2525',
        reach: '8000',
        actions: [
            { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' },
            { action_type: 'lead', value: '5' },
            { action_type: 'purchase', value: '2' },
        ],
        action_values: [{ action_type: 'purchase', value: '1000' }],
        purchase_roas: [],
    });
    strict_1.default.deepEqual(parsed, {
        spend: 250.5,
        impressions: 10000,
        clicks: 200,
        ctr: 2,
        cpc: 1.2525,
        reach: 8000,
        conversations: 12,
        leads: 5,
        purchases: 2,
        purchaseValue: 1000,
        roas: 3.99,
    });
});
(0, node_test_1.default)('parseIns respeita purchase_roas quando a Meta ja devolve o valor', () => {
    const parsed = (0, utils_1.parseIns)({
        spend: '100',
        actions: [{ action_type: 'purchase', value: '1' }],
        action_values: [{ action_type: 'purchase', value: '450' }],
        purchase_roas: [{ value: '4.5' }],
    });
    strict_1.default.equal(parsed?.roas, 4.5);
    strict_1.default.equal(parsed?.purchaseValue, 450);
    strict_1.default.equal(parsed?.purchases, 1);
});
