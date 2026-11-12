// Reconcile LLC invoices against the separate business Pay Hub. This module runs
// only in the website's Pages Function; the integration key never reaches a client.
const HUB = 'https://parma-ticket-payhub.pages.dev';
export const LLC_PROFILE = 'parma-entertainment-group-llc';
const INVOICE_STORE = 'https://rickparma-jsonbin-proxy.saxmanrp.workers.dev/invoices';

const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const cents = items => (items || []).reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0);
const balance = invoice => cents(invoice.events) + cents(invoice.lineItems) - cents(invoice.payments);
const parse = row => { try { return JSON.parse(row.metadata_json || '{}'); } catch { return {}; } };

async function invoicesRead(fetcher) {
  const response = await fetcher(`${INVOICE_STORE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) fail('Invoice storage is unavailable.', 503);
  const data = await response.json();
  if (!Array.isArray(data?.record?.invoices)) fail('Invoice storage is unavailable.', 503);
  return data.record.invoices;
}

async function invoicesWrite(fetcher, invoices) {
  const response = await fetcher(INVOICE_STORE, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invoices })
  });
  if (!response.ok) fail('Could not update the invoice balance. Please retry.', 503);
}

function requireInvoice(invoices, invoiceId) {
  const invoice = invoices.find(item => item.id === invoiceId);
  if (!invoice || invoice.profileId !== LLC_PROFILE) fail('Business invoice not found.', 404);
  return invoice;
}

async function attempts(env, invoiceId) {
  const result = await env.PAYMENT_DB.prepare(
    "SELECT * FROM payment_intents WHERE origin_app='business_invoice' AND reference=? ORDER BY created_at DESC"
  ).bind(invoiceId).all();
  return result.results || [];
}

async function hubIntent(env, id, fetcher) {
  const response = await fetcher(`${HUB}/api/integrations/intents/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.BUSINESS_INTEGRATION_API_KEY}` }, cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.intent) fail('Business payment status is unavailable. Please retry.', 503);
  return result.intent;
}

function verified(intent, row, invoiceId) {
  if (intent.id !== parse(row).hubIntentId || intent.reference !== invoiceId ||
      intent.metadata?.issuerProfileId !== LLC_PROFILE || intent.currency !== 'USD' ||
      intent.amountCents !== row.amount_cents || intent.type !== 'invoice' ||
      intent.originApp !== 'business_integration') {
    fail('Business payment details did not match the invoice.', 409);
  }
  if (['PAID', 'REFUNDED'].includes(intent.status)) {
    if (intent.provider !== 'square' || !intent.providerPaymentId ||
        !Number.isSafeInteger(intent.refundedCents) || intent.refundedCents < 0 ||
        intent.refundedCents > row.amount_cents ||
        (intent.status === 'REFUNDED' && intent.refundedCents !== row.amount_cents)) {
      fail('Business payment confirmation did not match the charge.', 409);
    }
    if ((parse(row).refundedCents || 0) > intent.refundedCents) fail('The refund status moved backwards.', 409);
  } else if (parse(row).hubStatus === 'PAID' || parse(row).hubStatus === 'REFUNDED') {
    fail('A completed payment cannot return to pending or failed.', 409);
  }
}

async function saveAttemptStatus(env, row, intent) {
  const old = parse(row);
  const metadata = { ...old, hubStatus: intent.status, refundedCents: intent.refundedCents || 0 };
  // The personal database already supports OPEN, PAID, FAILED and EXPIRED.
  // A fully refunded charge remains a recorded payment with a zero net ledger
  // amount; Hub status and refund cents are retained in metadata.
  const status = ['PAID', 'REFUNDED'].includes(intent.status) ? 'PAID'
    : ['FAILED', 'EXPIRED', 'CANCELLED'].includes(intent.status) ? 'FAILED' : 'OPEN';
  if (old.hubStatus === intent.status && old.refundedCents === metadata.refundedCents &&
      row.status === status && row.provider_payment_id === (intent.providerPaymentId || null)) return;
  await env.PAYMENT_DB.prepare(
    'UPDATE payment_intents SET status=?, provider_payment_id=?, metadata_json=?, updated_at=? WHERE id=?'
  ).bind(status, intent.providerPaymentId || null, JSON.stringify(metadata), new Date().toISOString(), row.id).run();
}

// Always re-read the saved invoice before writing. A second status refresh can
// safely replay the same charge, and later refunds update the same ledger row.
async function recordPayment(fetcher, invoiceId, row, intent) {
  const invoices = await invoicesRead(fetcher);
  const invoice = requireInvoice(invoices, invoiceId);
  const duplicate = invoices.some(item => item.id !== invoiceId && (item.payments || []).some(
    payment => payment.source === 'business_payment_hub' && payment.transactionId === intent.providerPaymentId
  ));
  if (duplicate) fail('This Square payment is already recorded on another invoice.', 409);
  const payments = invoice.payments || (invoice.payments = []);
  const existing = payments.find(payment => payment.source === 'business_payment_hub' && payment.transactionId === intent.providerPaymentId);
  const netCents = row.amount_cents - intent.refundedCents;
  if (existing && existing.businessIntentId !== intent.id) fail('This Square payment belongs to another checkout.', 409);
  if (existing && existing.refundedCents > intent.refundedCents) fail('The refund status moved backwards.', 409);
  if (existing && existing.refundedCents === intent.refundedCents && Math.round(existing.amount * 100) === netCents) return false;
  const payment = {
    date: intent.paidAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    amount: netCents / 100, method: intent.refundedCents ? 'Card (refund applied)' : 'Card',
    source: 'business_payment_hub', transactionId: intent.providerPaymentId,
    businessIntentId: intent.id, grossAmountCents: row.amount_cents, refundedCents: intent.refundedCents
  };
  if (existing) Object.assign(existing, payment); else payments.push(payment);
  await invoicesWrite(fetcher, invoices);
  return true;
}

export async function reconcileBusinessInvoice(env, invoiceId, fetcher = fetch) {
  if (!env.BUSINESS_INTEGRATION_API_KEY || !env.PAYMENT_DB) fail('Business payment service is not configured.', 503);
  let invoices = await invoicesRead(fetcher);
  requireInvoice(invoices, invoiceId);
  let changed = false;
  const rows = await attempts(env, invoiceId);
  for (const row of rows) {
    const hubId = parse(row).hubIntentId;
    if (!hubId) continue; // Create retry will recover this using the stable request UUID.
    const intent = await hubIntent(env, hubId, fetcher);
    verified(intent, row, invoiceId);
    if (['PAID', 'REFUNDED'].includes(intent.status)) {
      changed = await recordPayment(fetcher, invoiceId, row, intent) || changed;
    }
    await saveAttemptStatus(env, row, intent);
  }
  if (changed) invoices = await invoicesRead(fetcher);
  return { invoice: requireInvoice(invoices, invoiceId), changed };
}

async function requestUuid(invoiceId, amountCents, sequence) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    `business-invoice:${invoiceId}:${amountCents}:${sequence}`
  ))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function createAttempt(env, invoice, amountCents, sequence) {
  const id = await requestUuid(invoice.id, amountCents, sequence);
  const created = new Date().toISOString();
  await env.PAYMENT_DB.prepare(`
    INSERT OR IGNORE INTO payment_intents (id,type,status,amount_cents,currency,title,description,reference,
      customer_name,customer_email,customer_phone,metadata_json,created_at,updated_at,origin_app,fulfillment_status)
    VALUES (?,'invoice','OPEN',?,'USD',?,?,?,?,?,?,?,?,?,'business_invoice','PENDING')
  `).bind(id, amountCents, `Invoice payment — ${invoice.clientName}`, 'Entertainment services',
    invoice.id, invoice.clientName, invoice.clientEmail, invoice.clientPhone || null,
    JSON.stringify({ issuerProfileId: LLC_PROFILE, requestId: id, invoiceNumber: invoice.invoiceNumber }), created, created).run();
  const found = await env.PAYMENT_DB.prepare('SELECT * FROM payment_intents WHERE id=?').bind(id).first();
  if (!found || found.reference !== invoice.id || found.amount_cents !== amountCents || found.origin_app !== 'business_invoice')
    fail('Could not persist the business checkout.', 503);
  return found;
}

export async function createBusinessCheckout(env, invoiceId, requestedCents, fetcher = fetch) {
  if (!Number.isSafeInteger(requestedCents) || requestedCents < 1) fail('Enter a valid payment amount.');
  const { invoice } = await reconcileBusinessInvoice(env, invoiceId, fetcher);
  const due = balance(invoice);
  if (due <= 0) fail('This invoice is already paid in full.', 409);
  const amountCents = Math.min(requestedCents, due);
  if (!invoice.clientName?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.clientEmail || ''))
    fail('Add a client name and email to this invoice before requesting payment.');
  const rows = await attempts(env, invoiceId);
  let row = rows.find(item => item.amount_cents === amountCents && item.status === 'OPEN');
  if (!row) row = await createAttempt(env, invoice, amountCents, rows.filter(item => item.amount_cents === amountCents).length);
  const metadata = parse(row);
  const requestId = metadata.requestId || row.id;
  // Even if the first POST succeeded but its response was lost, the same UUID
  // gets the same Hub intent on the next request.
  const response = await fetcher(`${HUB}/api/integrations/intents`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.BUSINESS_INTEGRATION_API_KEY}` },
    body: JSON.stringify({ requestId, type: 'invoice', issuerProfileId: LLC_PROFILE, amountCents,
      currency: 'USD', title: row.title, description: row.description,
      reference: row.reference, customerName: row.customer_name, customerEmail: row.customer_email })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.intent?.id || !result.checkoutUrl)
    fail(result.error || 'Business checkout is unavailable. Please retry.', response.status >= 500 ? 503 : 409);
  if (result.intent.reference !== invoice.id || result.intent.amountCents !== amountCents ||
      result.intent.currency !== 'USD' || result.intent.metadata?.issuerProfileId !== LLC_PROFILE)
    fail('Business checkout details did not match the invoice.', 409);
  if (metadata.hubIntentId && metadata.hubIntentId !== result.intent.id) fail('Checkout retry returned a different payment.', 409);
  await env.PAYMENT_DB.prepare('UPDATE payment_intents SET metadata_json=?, updated_at=? WHERE id=?')
    .bind(JSON.stringify({ ...metadata, requestId, hubIntentId: result.intent.id }), new Date().toISOString(), row.id).run();
  return { checkoutUrl: new URL(result.checkoutUrl, HUB).href, intentId: result.intent.id };
}
