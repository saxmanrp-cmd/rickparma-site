import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fulfillInvoice } from '../functions/api/[[path]].js';
import { notifyInvoicePayment } from '../lib/invoice-payment-alert.js';

function paymentDb(db) {
  return { prepare(sql) { return {
    bind(...params) { return {
      async run() { const result = db.prepare(sql).run(...params); return { meta:{ changes:result.changes } }; }
    }; },
    async run() { const result = db.prepare(sql).run(); return { meta:{ changes:result.changes } }; }
  }; } };
}

test('one owner text per personal partial/full charge, not per fulfillment replay', async () => {
  const sql = new DatabaseSync(':memory:');
  const env = { PAYMENT_DB:paymentDb(sql), SMS_BLAST_ADMIN_TOKEN:'server-key', TIP_NOTIFICATION_PHONE:'7732091124' };
  let invoices = [{ id:'personal-1', invoiceNumber:'1001', clientName:'Alex', clientPhone:'7735550100',
    profileId:'rick-parma', lineItems:[{ amount:100 }], payments:[] }];
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options={}) => {
    if (url.includes('/invoices')) {
      if (options.method === 'PUT') { invoices = JSON.parse(options.body).invoices; return Response.json({ ok:true }); }
      return Response.json({ record:{ invoices:structuredClone(invoices) } });
    }
    if (url.includes('/api/conversations/reply')) {
      sent.push(JSON.parse(options.body));
      assert.equal(options.headers['X-Admin-Token'], 'server-key');
      return Response.json({ ok:true });
    }
    if (url.includes('/invoice-receipt')) return Response.json({ ok:true });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const partial = { id:'intent-1', reference:'personal-1', amountCents:3000, provider:'square', providerPaymentId:'square-1' };
    assert.equal(await fulfillInvoice(env, partial), 'FULFILLED');
    assert.equal(await fulfillInvoice(env, partial), 'FULFILLED');
    assert.equal(invoices[0].payments.length, 1);
    assert.match(sent[0].message, /Received \$30\.00\nPartial payment · Balance \$70\.00/);
    const full = { ...partial, id:'intent-2', amountCents:7000, providerPaymentId:'square-2' };
    assert.equal(await fulfillInvoice(env, full), 'FULFILLED');
    assert.equal(await fulfillInvoice(env, full), 'FULFILLED');
    assert.equal(invoices[0].payments.length, 2);
    assert.equal(sent.length, 2);
    assert.match(sent[1].message, /Received \$70\.00\nPaid in full/);
    assert.equal(sent[1].phone, '+17732091124');
  } finally { globalThis.fetch = originalFetch; sql.close(); }
});

test('failed text retries once, while historical payments do not create alerts', async () => {
  const sql = new DatabaseSync(':memory:');
  const env = { PAYMENT_DB:paymentDb(sql), SMS_BLAST_ADMIN_TOKEN:'server-key', TIP_NOTIFICATION_PHONE:'+17732091124' };
  const invoice = { id:'historical', clientName:'Buyer', lineItems:[{amount:10}], payments:[] };
  let calls = 0;
  const fetcher = async () => { calls++; return calls === 1 ? new Response('failed',{status:503}) : Response.json({ok:true}); };
  const options = { invoice, source:'business', paymentId:'sq-one', amountCents:300, balanceCents:700 };
  await assert.rejects(notifyInvoicePayment(env, { ...options, newPayment:true }, fetcher), /text failed/);
  assert.equal(await notifyInvoicePayment(env, { ...options, newPayment:false }, fetcher), true);
  assert.equal(await notifyInvoicePayment(env, { ...options, newPayment:false }, fetcher), false);
  assert.equal(await notifyInvoicePayment(env, { ...options, paymentId:'old-charge', newPayment:false }, fetcher), false);
  assert.equal(calls, 2);
  sql.close();
});
