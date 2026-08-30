export async function onRequest({ env }) {
  const out = { ok: true, adminKeyConfigured: Boolean(env.ADMIN_API_KEY), paymentDbBound: Boolean(env.PAYMENT_DB) };
  try {
    if (!env.PAYMENT_DB) throw new Error('PAYMENT_DB binding missing');
    const count = await env.PAYMENT_DB.prepare('SELECT COUNT(*) AS total FROM payment_intents').first();
    out.paymentIntentsReadable = true;
    out.transactionCount = Number(count?.total || 0);
  } catch (e) {
    out.paymentIntentsReadable = false;
    out.error = e?.message || String(e);
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
