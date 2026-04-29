import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCurrencyInput } from '../lib/financeiro'

test('parseCurrencyInput aceita formatos monetarios pt-BR e limpos', () => {
  assert.equal(parseCurrencyInput('1234,56'), 1234.56)
  assert.equal(parseCurrencyInput('1.234,56'), 1234.56)
  assert.equal(parseCurrencyInput('R$ 1.234,56'), 1234.56)
  assert.equal(parseCurrencyInput('2500'), 2500)
  assert.equal(parseCurrencyInput(89.9), 89.9)
})

test('parseCurrencyInput rejeita entradas vazias ou invalidas', () => {
  assert.equal(parseCurrencyInput(''), null)
  assert.equal(parseCurrencyInput('R$'), null)
  assert.equal(parseCurrencyInput('abc'), null)
  assert.equal(parseCurrencyInput(undefined), null)
})
