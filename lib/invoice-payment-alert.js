// One owner SMS per confirmed invoice charge. The D1 claim also lets a failed
// send retry when the paid invoice is reconciled again. Existing historical
// ledger entries never create a claim, so deployment does not back-text Rick.
const SMS_URL = 'https://sms-blast.saxmanrp.workers.dev/api/conversations/reply';

const dollars = cents => `$${(cents / 100).toFixed(2)}`;

export async function notifyInvoicePayment(env, {
  invoice, source, paymentId, amountCents, balanceCents, newPayment
}, fetcher = fetch) {
  if (!env.PAYMENT_DB || !env.SMS_BLAST_ADMIN_TOKEN || !env.TIP_NOTIFICATION_PHONE ||
      !paymentId || !Number.isSafeInteger(amountCents) || amountCents <= 0) return false;

  await env.PAYMENT_DB.prepare(`CREATE TABLE IF NOT EXISTS invoice_payment_alerts (
    payment_key TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  const key = `${source}:${paymentId}`;
  const now = new Date().toISOString();
  if (newPayment) await env.PAYMENT_DB.prepare(`
    INSERT OR IGNORE INTO invoice_payment_alerts (payment_key, invoice_id, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(key, invoice.id, now, now).run();
  // Only payments first recorded after this feature was deployed have a row.
  const claim = await env.PAYMENT_DB.prepare(`
    UPDATE invoice_payment_alerts SET status='sending', updated_at=?
    WHERE payment_key=? AND invoice_id=? AND status='pending'
  `).bind(now, key, invoice.id).run();
  if (!claim.meta?.changes) return false;

  const digits = String(env.TIP_NOTIFICATION_PHONE).replace(/\D/g, '');
  const phone = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const issuer = invoice.profileId === 'parma-entertainment-group-llc' ? 'Parma Entertainment Group LLC' : 'Rick Parma';
  const number = invoice.invoiceNumber ? ` #${invoice.invoiceNumber}` : '';
  const status = balanceCents <= 0 ? 'Paid in full' : `Partial payment · Balance ${dollars(balanceCents)}`;
  const message = [`INVOICE PAYMENT · ${issuer}${number}`, invoice.clientName || 'Client',
    `Received ${dollars(amountCents)}`, status].join('\n');
  try {
    const response = await fetcher(SMS_URL, {
      method: 'POST',
      headers: { 'content-type':'application/json', 'X-Admin-Token':env.SMS_BLAST_ADMIN_TOKEN },
      body: JSON.stringify({ phone, message })
    });
    if (!response.ok) throw new Error(`Invoice payment text failed: ${response.status}`);
    await env.PAYMENT_DB.prepare("UPDATE invoice_payment_alerts SET status='sent', updated_at=? WHERE payment_key=? AND invoice_id=?")
      .bind(new Date().toISOString(), key, invoice.id).run();
    return true;
  } catch (error) {
    await env.PAYMENT_DB.prepare("UPDATE invoice_payment_alerts SET status='pending', updated_at=? WHERE payment_key=? AND invoice_id=? AND status='sending'")
      .bind(new Date().toISOString(), key, invoice.id).run();
    throw error;
  }
}
