import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceAmountCents } from '../lib/invoice-price.js';
import { invoiceBalanceCents } from '../functions/api/[[path]].js';

test('optional invoice price is included in both backend payment balance and partial payments', () => {
  const invoice = { events:[{amount:'2555.00'}], lineItems:[], payments:[],
    priceOption:{onlinePriceEnabled:true,cashDiscountApplied:false} };
  assert.equal(invoiceAmountCents(invoice), 262910);
  assert.equal(invoiceBalanceCents(invoice), 262910);
  invoice.payments.push({amount:1000});
  assert.equal(invoiceBalanceCents(invoice), 162910);
  invoice.priceOption.cashDiscountApplied = true;
  invoice.payments = [];
  assert.equal(invoiceBalanceCents(invoice), 255500);
  assert.equal(invoiceAmountCents({ ...invoice, priceOption:undefined }), 255500);
});
