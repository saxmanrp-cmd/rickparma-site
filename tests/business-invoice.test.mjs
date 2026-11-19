import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBusinessCheckout, reconcileBusinessInvoice, LLC_PROFILE } from '../lib/business-invoice.js';

function setup({ alerts = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE payment_intents (
    id TEXT PRIMARY KEY, type TEXT, status TEXT, amount_cents INTEGER, currency TEXT,
    title TEXT, description TEXT, reference TEXT, customer_name TEXT, customer_email TEXT,
    customer_phone TEXT, metadata_json TEXT, created_at TEXT, updated_at TEXT,
    origin_app TEXT, fulfillment_status TEXT, provider_payment_id TEXT UNIQUE
  )`);
  const env = {
    BUSINESS_INTEGRATION_API_KEY: 'test-server-only-key',
    ...(alerts ? { SMS_BLAST_ADMIN_TOKEN: 'sms-key', TIP_NOTIFICATION_PHONE: '7732091124' } : {}),
    PAYMENT_DB: { prepare(query) { return {
      bind(...values) { const statement = sql.prepare(query); return {
        async run() { const result = statement.run(...values); return { ...result, meta: { changes: result.changes } }; },
        async all() { return { results: statement.all(...values) }; },
        async first() { return statement.get(...values); }
      }; }
      , async run() { const result = sql.prepare(query).run(); return { ...result, meta: { changes: result.changes } }; }
    }; } }
  };
  const invoice = { id: 'llc-test', profileId: LLC_PROFILE, invoiceNumber: 2001,
    clientName: 'Test Buyer', clientEmail: 'buyer@example.test',
    events: [], lineItems: [{ description: 'Test service', amount: '3.00' }], payments: [] };
  const personal = { id: 'personal', clientName: 'Personal', clientEmail: 'p@example.test',
    lineItems: [{ amount: '10.00' }], payments: [] };
  let records = [invoice, personal];
  const intents = new Map();
  const texts = [];
  let hubCreates = 0;
  const fetcher = async (url, options = {}) => {
    if (url.includes('/api/conversations/reply')) {
      assert.equal(options.headers['X-Admin-Token'], 'sms-key');
      texts.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    }
    if (url.startsWith('https://rickparma-jsonbin-proxy.saxmanrp.workers.dev/invoices')) {
      if (options.method === 'PUT') { records = structuredClone(JSON.parse(options.body).invoices); return Response.json({ ok: true }); }
      return Response.json({ record: { invoices: structuredClone(records) } });
    }
    assert.match(options.headers.authorization, /^Bearer test-server-only-key$/);
    if (options.method === 'POST') {
      hubCreates++;
      const body = JSON.parse(options.body);
      assert.equal(body.issuerProfileId, LLC_PROFILE);
      let intent = intents.get(body.requestId);
      if (!intent) {
        intent = { id: `hub-${body.requestId}`, type: 'invoice', originApp: 'business_integration',
          reference: body.reference, amountCents: body.amountCents, currency: 'USD',
          metadata: { issuerProfileId: LLC_PROFILE }, status: 'OPEN', refundedCents: 0 };
        intents.set(body.requestId, intent);
      }
      return Response.json({ intent, checkoutUrl: `/pay/payment?intent=${intent.id}` }, { status: 201 });
    }
    const intent = [...intents.values()].find(item => url.endsWith(item.id));
    return intent ? Response.json({ intent }) : Response.json({ error: 'missing' }, { status: 404 });
  };
  return { sql, env, fetcher, intents, texts, invoice: () => records[0], personal: () => records[1], hubCreates: () => hubCreates };
}

test('LLC sends one partial and one paid-in-full alert, none on refresh or refund', async () => {
  const app = setup({ alerts: true });
  await createBusinessCheckout(app.env, 'llc-test', 100, app.fetcher);
  const first = [...app.intents.values()][0];
  first.status = 'PAID'; first.provider = 'square'; first.providerPaymentId = 'sq-llc-one';
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.texts.length, 1);
  assert.match(app.texts[0].message, /Parma Entertainment Group LLC #2001\nTest Buyer\nReceived \$1\.00\nPartial payment · Balance \$2\.00/);
  await createBusinessCheckout(app.env, 'llc-test', 200, app.fetcher);
  const second = [...app.intents.values()][1];
  second.status = 'PAID'; second.provider = 'square'; second.providerPaymentId = 'sq-llc-two';
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.texts.length, 2);
  assert.match(app.texts[1].message, /Received \$2\.00\nPaid in full/);
  first.status = 'REFUNDED'; first.refundedCents = 100;
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.texts.length, 2);
  app.sql.close();
});

test('stable request UUID, partial payments, duplicates, and refunds', async () => {
  const app = setup();
  const first = await createBusinessCheckout(app.env, 'llc-test', 100, app.fetcher);
  const retry = await createBusinessCheckout(app.env, 'llc-test', 100, app.fetcher);
  assert.equal(retry.intentId, first.intentId);
  assert.equal(app.hubCreates(), 2);
  const row = app.sql.prepare("SELECT * FROM payment_intents WHERE origin_app='business_invoice'").get();
  assert.equal(row.reference, 'llc-test'); assert.equal(row.amount_cents, 100);
  assert.equal(JSON.parse(row.metadata_json).hubIntentId, first.intentId);
  const intent = [...app.intents.values()][0];
  intent.status = 'PAID'; intent.provider = 'square'; intent.providerPaymentId = 'square-1';
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.length, 1);
  assert.equal(app.invoice().payments[0].amount, 1);
  assert.equal(app.personal().payments.length, 0);
  const second = await createBusinessCheckout(app.env, 'llc-test', 200, app.fetcher);
  assert.notEqual(second.intentId, first.intentId);
  const secondIntent = [...app.intents.values()][1];
  secondIntent.status = 'PAID'; secondIntent.provider = 'square'; secondIntent.providerPaymentId = 'square-2';
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.reduce((sum, p) => sum + p.amount, 0), 3);
  intent.refundedCents = 50;
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.find(p => p.transactionId === 'square-1').amount, 0.5);
  intent.status = 'REFUNDED'; intent.refundedCents = 100;
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.find(p => p.transactionId === 'square-1').amount, 0);
  assert.equal(app.invoice().payments.length, 2);
  const afterRefund = await createBusinessCheckout(app.env, 'llc-test', 100, app.fetcher);
  assert.notEqual(afterRefund.intentId, first.intentId);
  assert.equal(app.personal().payments.length, 0);
  app.sql.close();
});

test('pending, failed, mismatched, and personal invoices never become paid', async () => {
  const app = setup();
  await assert.rejects(createBusinessCheckout(app.env, 'personal', 300, app.fetcher), /Business invoice not found/);
  await createBusinessCheckout(app.env, 'llc-test', 300, app.fetcher);
  const intent = [...app.intents.values()][0];
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.length, 0);
  intent.status = 'FAILED';
  await reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher);
  assert.equal(app.invoice().payments.length, 0);
  intent.status = 'PAID'; intent.provider = 'square'; intent.providerPaymentId = 'square-bad';
  intent.metadata.issuerProfileId = 'rick-parma';
  await assert.rejects(reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher), /did not match/);
  assert.equal(app.invoice().payments.length, 0);
  intent.metadata.issuerProfileId = LLC_PROFILE;
  intent.currency = 'EUR';
  await assert.rejects(reconcileBusinessInvoice(app.env, 'llc-test', app.fetcher), /did not match/);
  assert.equal(app.invoice().payments.length, 0);
  app.sql.close();
});

test('simultaneous checkout requests use one persisted UUID and Hub intent', async () => {
  const app = setup();
  const [one, two] = await Promise.all([
    createBusinessCheckout(app.env, 'llc-test', 300, app.fetcher),
    createBusinessCheckout(app.env, 'llc-test', 300, app.fetcher)
  ]);
  assert.equal(one.intentId, two.intentId);
  assert.equal(app.sql.prepare("SELECT COUNT(*) AS total FROM payment_intents WHERE origin_app='business_invoice'").get().total, 1);
  app.sql.close();
});

test('business checkout uses the standard invoice price for a partial or full charge', async () => {
  const app = setup();
  app.invoice().priceOption = { onlinePriceEnabled:true, cashDiscountApplied:false };
  await createBusinessCheckout(app.env, 'llc-test', 100, app.fetcher);
  await createBusinessCheckout(app.env, 'llc-test', 999, app.fetcher);
  assert.deepEqual(app.sql.prepare("SELECT amount_cents FROM payment_intents WHERE origin_app='business_invoice' ORDER BY amount_cents").all().map(row => row.amount_cents),
    [100, 309]); // $3 base becomes $3.09 with a flat 2.9% adjustment.
  app.sql.close();
});
