import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { reconcilePersonalInvoice } from '../functions/api/[[path]].js';

test('a confirmed personal checkout restores a lost invoice payment once', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE payment_intents (
    id TEXT, type TEXT, origin_app TEXT, reference TEXT, status TEXT,
    currency TEXT, amount_cents INTEGER, provider TEXT, provider_payment_id TEXT,
    provider_order_id TEXT, paid_at TEXT, metadata_json TEXT
  )`);
  const insert = sql.prepare(`INSERT INTO payment_intents
    (id,type,origin_app,reference,status,currency,amount_cents,provider,provider_payment_id,paid_at)
    VALUES (?,'invoice','invoice_manager',?,?,'USD',?,'square',?,?)`);
  insert.run('paid-1','personal-1','PAID',300,'square-1','2026-11-22T18:00:00Z');
  insert.run('pending-2','personal-1','OPEN',700,null,null);
  const env = { PAYMENT_DB:{ prepare(query){ return { bind(...values){
    return { async all(){ return { results:sql.prepare(query).all(...values) }; } };
  } }; } } };
  let invoices = [{ id:'personal-1', profileId:'rick-parma', clientName:'Kaleta Inc',
    lineItems:[{ amount:3 }], payments:[] },
    { id:'business-1', profileId:'parma-entertainment-group-llc', payments:[] }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes('/invoices')) throw new Error('Unexpected external request');
    if (options.method === 'PUT') {
      invoices = structuredClone(JSON.parse(options.body).invoices);
      return Response.json({ ok:true });
    }
    return Response.json({ record:{ invoices:structuredClone(invoices) } });
  };
  try {
    const first = await reconcilePersonalInvoice(env, 'personal-1');
    assert.equal(first.invoice.payments.length, 1);
    assert.equal(first.invoice.payments[0].amount, 3);
    assert.equal(first.invoice.payments[0].transactionId, 'square-1');
    assert.equal((await reconcilePersonalInvoice(env, 'personal-1')).invoice.payments.length, 1);
    assert.equal(invoices[1].payments.length, 0);
    await assert.rejects(reconcilePersonalInvoice(env, 'business-1'), /Personal invoice not found/);
  } finally {
    globalThis.fetch = originalFetch;
    sql.close();
  }
});
