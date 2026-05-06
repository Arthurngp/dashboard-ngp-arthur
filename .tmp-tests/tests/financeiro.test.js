"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const financeiro_1 = require("../lib/financeiro");
(0, node_test_1.default)('parseCurrencyInput aceita formatos monetarios pt-BR e limpos', () => {
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('1234,56'), 1234.56);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('1.234,56'), 1234.56);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('R$ 1.234,56'), 1234.56);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('2500'), 2500);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)(89.9), 89.9);
});
(0, node_test_1.default)('parseCurrencyInput rejeita entradas vazias ou invalidas', () => {
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)(''), null);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('R$'), null);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)('abc'), null);
    strict_1.default.equal((0, financeiro_1.parseCurrencyInput)(undefined), null);
});
