// rickparma-site/functions/api/[[path]].js
// Central Payment Hub API — Cloudflare Pages Function.
// Handles Tip Rick, Song Request, Vocal Tutorial (Diamond Method), and Invoice Manager
// checkouts through one Payment Intent model backed by D1 (binding: PAYMENT_DB).
//
// Square handles cards / Apple Pay / Cash App Pay.
// PayPal handles PayPal / Venmo.
//
// SECURITY: no Square/PayPal secrets ever ship to the browser. This file only runs
// server-side. The public /pay page only ever receives env.SQUARE_APP_ID,
// env.SQUARE_LOCATION_ID and env.PAYPAL_CLIENT_ID via /api/config — none of those are secret,
// they are meant to be public (Square/PayPal's own SDKs require them client-side).

const ALLOWED_PUBLIC_TYPES = new Set(["tip", "song_request", "vocal_tutorial"]);
const PROXY_BASE = "https://rickparma-jsonbin-proxy.saxmanrp.workers.dev";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(value, max = 255) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function positiveInteger(value, label = "amount") {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return n;
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function squareBase(env) {
  return env.SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function paypalBase(env) {
  return env.PAYPAL_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function serializeIntent(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    originApp: row.origin_app,
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    amountCents: row.amount_cents,
    currency: row.currency,
    title: row.title,
    description: row.description,
    reference: row.reference,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
    paidAt: row.paid_at,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    providerOrderId: row.provider_order_id
  };
}

async function getIntent(env, id) {
  const row = await env.PAYMENT_DB
    .prepare("SELECT * FROM payment_intents WHERE id = ?")
    .bind(id)
    .first();
  return serializeIntent(row);
}

async function getIntentByProviderPaymentId(env, paymentId) {
  const row = await env.PAYMENT_DB
    .prepare("SELECT * FROM payment_intents WHERE provider_payment_id = ?")
    .bind(paymentId)
    .first();
  return serializeIntent(row);
}

async function insertIntent(env, data) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();

  await env.PAYMENT_DB.prepare(`
    INSERT INTO payment_intents (
      id, type, status, amount_cents, currency,
      title, description, reference,
      customer_name, customer_email, customer_phone,
      metadata_json, created_at, updated_at, origin_app, fulfillment_status
    ) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).bind(
    id,
    data.type,
    data.amountCents,
    data.currency || "USD",
    data.title,
    data.description || null,
    data.reference || null,
    data.customerName || null,
    data.customerEmail || null,
    data.customerPhone || null,
    JSON.stringify(data.metadata || {}),
    createdAt,
    createdAt,
    data.originApp || data.type || null
  ).run();

  return getIntent(env, id);
}

async function insertEvent(env, { intentId, eventType, provider = null, providerId = null, amountCents = null, payload = {} }) {
  await env.PAYMENT_DB.prepare(`
    INSERT INTO payment_events (
      id, intent_id, event_type, provider, provider_id, amount_cents, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), intentId, eventType, provider, providerId, amountCents, JSON.stringify(payload), nowIso()
  ).run();
}

// Idempotent webhook-event claim: returns true if this is the first time we've
// seen this provider+eventId (and records it), false if it's a duplicate delivery.
async function claimWebhookEvent(env, { id, provider, eventType, intentId, payload }) {
  const result = await env.PAYMENT_DB.prepare(`
    INSERT OR IGNORE INTO webhook_events (id, provider, event_type, intent_id, payload_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, provider, eventType, intentId || null, JSON.stringify(payload || {}), nowIso()).run();

  return Boolean(result.meta && result.meta.changes > 0);
}

async function markIntentPaid(env, { intentId, provider, paymentId = null, orderId = null }) {
  const existing = await getIntent(env, intentId);
  if (!existing) throw new Error("Payment intent not found.");
  if (existing.status === "PAID") return existing;

  const paidAt = nowIso();
  await env.PAYMENT_DB.prepare(`
    UPDATE payment_intents
    SET status = 'PAID', provider = ?, provider_payment_id = ?, provider_order_id = ?, paid_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(provider, paymentId, orderId, paidAt, paidAt, intentId).run();

  const paid = await getIntent(env, intentId);
  await runFulfillment(env, paid).catch((err) => {
    console.error("Fulfillment error", intentId, err);
  });
  return paid;
}

// --- Fulfillment dispatch -----------------------------------------------
// Runs automatically once an intent is confirmed PAID (from either the
// synchronous provider response or a verified webhook). Marks its own
// completion on payment_intents.fulfillment_status so it's safe to re-run.

async function markFulfillment(env, intentId, status) {
  await env.PAYMENT_DB.prepare(
    `UPDATE payment_intents SET fulfillment_status = ?, updated_at = ? WHERE id = ?`
  ).bind(status, nowIso(), intentId).run();
}

async function fulfillInvoice(env, intent) {
  if (!intent.reference) return "SKIPPED_NO_REFERENCE";
  const res = await fetch(`${PROXY_BASE}/invoices`);
  const data = await res.json();
  const invoices = (data && data.invoices) || [];
  const idx = invoices.findIndex((inv) => inv.id === intent.reference);
  if (idx === -1) return "SKIPPED_NOT_FOUND";

  const invoice = invoices[idx];
  invoice.payments = invoice.payments || [];
  invoice.payments.push({
    amount: intent.amountCents / 100,
    method: intent.provider,
    transactionId: intent.providerPaymentId || intent.providerOrderId || null,
    date: nowIso(),
    source: "payment_hub"
  });
  invoices[idx] = invoice;

  await fetch(`${PROXY_BASE}/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoices })
  });
  return "FULFILLED";
}

async function runFulfillment(env, intent) {
  let outcome = "NOOP";
  try {
    if (intent.type === "invoice") {
      outcome = await fulfillInvoice(env, intent);
    } else if (intent.type === "tip") {
      outcome = "FULFILLED"; // nothing to unlock — payment record itself is the fulfillment
    } else if (intent.type === "song_request" || intent.type === "vocal_tutorial") {
      // Wired up once Song Request / Diamond Method are updated to create their
      // linked record before checkout and pass its id through metadata.
      outcome = "PENDING_APP_INTEGRATION";
    }
  } catch (err) {
    console.error("runFulfillment error", intent.id, err);
    outcome = "ERROR";
  }

  await insertEvent(env, {
    intentId: intent.id,
    eventType: "FULFILLMENT_" + outcome,
    provider: intent.provider,
    amountCents: intent.amountCents,
    payload: { type: intent.type }
  });

  if (outcome === "FULFILLED") await markFulfillment(env, intent.id, "FULFILLED");
  else if (outcome === "ERROR") await markFulfillment(env, intent.id, "ERROR");
  else await markFulfillment(env, intent.id, "PENDING");
}

// --- Public + trusted-integration intent creation ------------------------

async function createPublicIntent(request, env) {
  const body = await request.json();
  const type = safeString(body.type, 40);

  if (!ALLOWED_PUBLIC_TYPES.has(type)) {
    return json({ error: "Unsupported checkout type." }, 400);
  }

  let amountCents;
  let title;
  let description = safeString(body.note, 120);
  const metadata = {};

  if (type === "tip") {
    amountCents = positiveInteger(body.amountCents);
    const min = Number(env.TIP_MIN_CENTS || 100);
    if (amountCents < min) return json({ error: `Minimum tip is $${(min / 100).toFixed(2)}.` }, 400);
    title = "Tip Rick Parma";
  }

  if (type === "song_request") {
    amountCents = positiveInteger(body.amountCents);
    const min = Number(env.SONG_REQUEST_MIN_CENTS || 500);
    if (amountCents < min) return json({ error: `Minimum song request is $${(min / 100).toFixed(2)}.` }, 400);
    const song = safeString(body.song, 100);
    if (!song) return json({ error: "Song request is required." }, 400);
    title = "Song Request";
    description = song;
    metadata.song = song;
    metadata.note = safeString(body.note, 120);
    if (body.songRequestId) metadata.songRequestId = safeString(body.songRequestId, 100);
  }

  if (type === "vocal_tutorial") {
    amountCents = positiveInteger(Number(env.VOCAL_TUTORIAL_PRICE_CENTS || 2000), "tutorial price");
    title = "Diamond Method Vocal Tutorial";
    description = "Rick Parma — Diamond Method course enrollment";
    metadata.product = "diamond_method";
  }

  const intent = await insertIntent(env, {
    type,
    originApp: type,
    amountCents,
    title,
    description,
    customerName: safeString(body.customerName, 100),
    customerEmail: safeString(body.customerEmail, 200),
    customerPhone: safeString(body.customerPhone, 40),
    metadata
  });

  await insertEvent(env, { intentId: intent.id, eventType: "INTENT_CREATED", amountCents: intent.amountCents, payload: { source: "public_checkout" } });
  return json({ intent }, 201);
}

function requireBearer(request, expected) {
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(expected && supplied && supplied === expected);
}

// Server-to-server only. Used by Invoice Manager (and future trusted apps) to open
// a checkout for an exact, browser-uncontrollable amount.
async function createIntegrationIntent(request, env) {
  if (!requireBearer(request, env.INTEGRATION_API_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const body = await request.json();
  const amountCents = positiveInteger(body.amountCents);
  const type = safeString(body.type, 40) || "invoice";

  const intent = await insertIntent(env, {
    type,
    originApp: safeString(body.originApp, 40) || type,
    amountCents,
    currency: safeString(body.currency, 3) || "USD",
    title: safeString(body.title, 120) || "Payment",
    description: safeString(body.description, 500),
    reference: safeString(body.reference, 127),
    customerName: safeString(body.customerName, 100),
    customerEmail: safeString(body.customerEmail, 200),
    customerPhone: safeString(body.customerPhone, 40),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {}
  });

  await insertEvent(env, { intentId: intent.id, eventType: "INTENT_CREATED", amountCents: intent.amountCents, payload: { source: "trusted_integration" } });

  const base = String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  return json({ intent, checkoutUrl: `${base}/pay/?intent=${encodeURIComponent(intent.id)}` }, 201);
}

// --- Square --------------------------------------------------------------

async function createSquarePayment(request, env) {
  const body = await request.json();
  const intentId = safeString(body.intentId, 100);
  const sourceId = safeString(body.sourceId, 500);
  if (!intentId || !sourceId) return json({ error: "Missing payment information." }, 400);

  const intent = await getIntent(env, intentId);
  if (!intent) return json({ error: "Payment intent not found." }, 404);
  if (intent.status === "PAID") {
    return json({ ok: true, alreadyPaid: true, paymentId: intent.providerPaymentId || intent.providerOrderId });
  }
  if (intent.status !== "OPEN") return json({ error: "Payment intent is not payable." }, 409);

  const payload = {
    source_id: sourceId,
    idempotency_key: `intent-${intent.id}`,
    amount_money: { amount: intent.amountCents, currency: intent.currency },
    location_id: env.SQUARE_LOCATION_ID,
    autocomplete: true,
    reference_id: intent.id,
    note: [intent.title, intent.description].filter(Boolean).join(" — ").slice(0, 500)
  };

  const response = await fetch(`${squareBase(env)}/v2/payments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "content-type": "application/json",
      "square-version": env.SQUARE_API_VERSION || "2026-07-15"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  await insertEvent(env, {
    intentId: intent.id,
    eventType: response.ok ? "SQUARE_PAYMENT_CREATED" : "SQUARE_PAYMENT_ERROR",
    provider: "square",
    providerId: data?.payment?.id || null,
    amountCents: intent.amountCents,
    payload: data
  });

  if (!response.ok) {
    console.error("Square error", JSON.stringify(data));
    const message = data?.errors?.[0]?.detail || "Square payment failed.";
    return json({ error: message }, response.status);
  }

  const paymentId = data.payment?.id;

  if (data.payment?.status === "COMPLETED") {
    await markIntentPaid(env, { intentId: intent.id, provider: "square", paymentId });
  }

  return json({ ok: true, paymentId, status: data.payment?.status });
}

// Square webhook signature: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody))
async function verifySquareSignature(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureHeader || !signatureKey) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signatureKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(notificationUrl + rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === signatureHeader;
}

async function handleSquareWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  const notificationUrl = env.SQUARE_WEBHOOK_URL || new URL(request.url).toString();

  const valid = await verifySquareSignature(rawBody, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl);
  if (!valid) {
    console.error("Square webhook signature verification failed");
    return json({ error: "Invalid signature." }, 401);
  }

  const body = safeJsonParse(rawBody, null);
  if (!body || !body.event_id) return json({ error: "Malformed event." }, 400);

  const isNew = await claimWebhookEvent(env, { id: body.event_id, provider: "square", eventType: body.type, payload: body });
  if (!isNew) return json({ ok: true, duplicate: true });

  const payment = body?.data?.object?.payment;
  if (payment && payment.status === "COMPLETED") {
    let intent = payment.reference_id ? await getIntent(env, payment.reference_id) : null;
    if (!intent) intent = await getIntentByProviderPaymentId(env, payment.id);
    if (intent) {
      await markIntentPaid(env, { intentId: intent.id, provider: "square", paymentId: payment.id });
    }
  }

  return json({ ok: true });
}

// --- PayPal ----------------------------------------------------------------

async function paypalAccessToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("PayPal OAuth error", data);
    throw new Error("PayPal authentication failed.");
  }
  return data.access_token;
}

async function createPayPalOrder(request, env) {
  const body = await request.json();
  const intentId = safeString(body.intentId, 100);
  const intent = await getIntent(env, intentId);

  if (!intent) return json({ error: "Payment intent not found." }, 404);
  if (intent.status === "PAID") return json({ error: "This payment is already complete." }, 409);
  if (intent.status !== "OPEN") return json({ error: "Payment intent is not payable." }, 409);

  const token = await paypalAccessToken(env);

  const purchaseUnit = {
    reference_id: intent.id,
    custom_id: intent.id,
    amount: { currency_code: intent.currency, value: (intent.amountCents / 100).toFixed(2) },
    description: [intent.title, intent.description].filter(Boolean).join(" — ").slice(0, 127)
  };
  if (intent.type === "invoice" && intent.reference) {
    purchaseUnit.invoice_id = intent.reference.slice(0, 127);
  }

  const response = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `intent-${intent.id}` },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [purchaseUnit] })
  });

  const data = await response.json();

  await insertEvent(env, {
    intentId: intent.id,
    eventType: response.ok ? "PAYPAL_ORDER_CREATED" : "PAYPAL_ORDER_ERROR",
    provider: "paypal",
    providerId: data?.id || null,
    amountCents: intent.amountCents,
    payload: data
  });

  if (!response.ok) {
    console.error("PayPal create order error", JSON.stringify(data));
    return json({ error: "Unable to create PayPal order." }, response.status);
  }

  await env.PAYMENT_DB.prepare(`UPDATE payment_intents SET provider_order_id = ?, updated_at = ? WHERE id = ?`)
    .bind(data.id, nowIso(), intent.id).run();

  return json({ id: data.id });
}

async function capturePayPalOrder(request, orderId, env) {
  const body = await request.json();
  const intentId = safeString(body.intentId, 100);
  const intent = await getIntent(env, intentId);

  if (!intent) return json({ error: "Payment intent not found." }, 404);
  if (intent.status === "PAID") return json({ ok: true, alreadyPaid: true, id: intent.providerOrderId || orderId });
  if (intent.providerOrderId && intent.providerOrderId !== orderId) {
    return json({ error: "PayPal order does not match this payment." }, 409);
  }

  const token = await paypalAccessToken(env);
  const response = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "paypal-request-id": `capture-${orderId}` }
  });

  const data = await response.json();
  const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

  await insertEvent(env, {
    intentId: intent.id,
    eventType: response.ok ? "PAYPAL_ORDER_CAPTURED" : "PAYPAL_CAPTURE_ERROR",
    provider: "paypal",
    providerId: captureId || orderId,
    amountCents: intent.amountCents,
    payload: data
  });

  if (!response.ok) {
    console.error("PayPal capture error", JSON.stringify(data));
    return json({ error: "Unable to capture PayPal order." }, response.status);
  }

  if (data.status === "COMPLETED") {
    await markIntentPaid(env, { intentId: intent.id, provider: "paypal", paymentId: captureId, orderId });
  }

  return json({ ok: true, id: captureId || data.id, orderId: data.id, status: data.status });
}

// PayPal webhook verification via their server-to-server verify-webhook-signature API
// (avoids re-implementing their certificate-chain crypto ourselves).
async function verifyPayPalSignature(request, rawBody, env) {
  const token = await paypalAccessToken(env);
  const verifyBody = {
    auth_algo: request.headers.get("paypal-auth-algo"),
    cert_url: request.headers.get("paypal-cert-url"),
    transmission_id: request.headers.get("paypal-transmission-id"),
    transmission_sig: request.headers.get("paypal-transmission-sig"),
    transmission_time: request.headers.get("paypal-transmission-time"),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: safeJsonParse(rawBody, {})
  };

  const response = await fetch(`${paypalBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(verifyBody)
  });

  const data = await response.json();
  return data.verification_status === "SUCCESS";
}

async function handlePayPalWebhook(request, env) {
  const rawBody = await request.text();
  const rebuiltRequest = new Request(request.url, { method: "POST", headers: request.headers });

  const valid = await verifyPayPalSignature(rebuiltRequest, rawBody, env);
  if (!valid) {
    console.error("PayPal webhook signature verification failed");
    return json({ error: "Invalid signature." }, 401);
  }

  const body = safeJsonParse(rawBody, null);
  if (!body || !body.id) return json({ error: "Malformed event." }, 400);

  const isNew = await claimWebhookEvent(env, { id: body.id, provider: "paypal", eventType: body.event_type, payload: body });
  if (!isNew) return json({ ok: true, duplicate: true });

  if (body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const capture = body?.resource;
    const intentId = capture?.custom_id || capture?.supplementary_data?.related_ids?.order_id;
    let intent = intentId ? await getIntent(env, intentId) : null;
    if (!intent && capture?.id) intent = await getIntentByProviderPaymentId(env, capture.id);
    if (intent) {
      await markIntentPaid(env, { intentId: intent.id, provider: "paypal", paymentId: capture?.id });
    }
  }

  return json({ ok: true });
}

// --- Admin -----------------------------------------------------------------

async function listTransactions(request, env) {
  if (!requireBearer(request, env.ADMIN_API_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const rows = await env.PAYMENT_DB.prepare(`
    SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT 200
  `).all();

  return json({ transactions: (rows.results || []).map(serializeIntent) });
}

// --- Router ------------------------------------------------------------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";

  try {
    if (path === "/config" && request.method === "GET") {
      return json({
        square: {
          environment: env.SQUARE_ENV || "sandbox",
          applicationId: env.SQUARE_APP_ID || "",
          locationId: env.SQUARE_LOCATION_ID || ""
        },
        paypal: {
          environment: env.PAYPAL_ENV || "sandbox",
          clientId: env.PAYPAL_CLIENT_ID || ""
        },
        products: {
          vocalTutorialPriceCents: Number(env.VOCAL_TUTORIAL_PRICE_CENTS || 2000),
          tipMinCents: Number(env.TIP_MIN_CENTS || 100),
          songRequestMinCents: Number(env.SONG_REQUEST_MIN_CENTS || 500)
        }
      });
    }

    if (path === "/intents/public" && request.method === "POST") {
      return await createPublicIntent(request, env);
    }

    if (path === "/integrations/intents" && request.method === "POST") {
      return await createIntegrationIntent(request, env);
    }

    const getIntentMatch = path.match(/^\/intents\/([^/]+)$/);
    if (getIntentMatch && request.method === "GET") {
      const intent = await getIntent(env, decodeURIComponent(getIntentMatch[1]));
      return intent ? json({ intent }) : json({ error: "Payment intent not found." }, 404);
    }

    if (path === "/square/pay" && request.method === "POST") {
      return await createSquarePayment(request, env);
    }

    if (path === "/webhooks/square" && request.method === "POST") {
      return await handleSquareWebhook(request, env);
    }

    if (path === "/paypal/orders" && request.method === "POST") {
      return await createPayPalOrder(request, env);
    }

    const paypalCapture = path.match(/^\/paypal\/orders\/([^/]+)\/capture$/);
    if (paypalCapture && request.method === "POST") {
      return await capturePayPalOrder(request, decodeURIComponent(paypalCapture[1]), env);
    }

    if (path === "/webhooks/paypal" && request.method === "POST") {
      return await handlePayPalWebhook(request, env);
    }

    if (path === "/admin/transactions" && request.method === "GET") {
      return await listTransactions(request, env);
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    console.error("Payment hub error", error);
    return json({ error: error.message || "Unexpected error." }, 400);
  }
}
