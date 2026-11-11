import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./[[path]].js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace('export async function onRequest', 'async function onRequest'), context);
const invoiceBalanceCents = (invoice) => context.invoiceBalanceCents(invoice);

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
