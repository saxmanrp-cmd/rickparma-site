import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceBalanceCents } from '../functions/api/[[path]].js';

test('new event invoices retain a payable balance for partial checkout', () => {
  const invoice = {
    events: [{ amount: '850.00' }, { amount: '850.00' }, { amount: '850.00' }],
    lineItems: [], payments: []
  };
  assert.equal(invoiceBalanceCents(invoice), 255000);
  invoice.payments.push({ amount: 255 });
  assert.equal(invoiceBalanceCents(invoice), 229500);
  invoice.payments.push({ amount: 2295 });
  assert.equal(invoiceBalanceCents(invoice), 0);
});

test('shared charges and legacy line-item invoices use the same balance', () => {
  assert.equal(invoiceBalanceCents({ events:[{ amount: 400 }], lineItems:[{ amount:'25.50' }], payments:[{ amount: 100 }] }), 32550);
  assert.equal(invoiceBalanceCents({ lineItems:[{ amount:'100.00' }], payments:[] }), 10000);
});
