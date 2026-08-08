const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const pageTitle = $("#page-title");
const pageSubtitle = $("#page-subtitle");
const modePicker = $("#mode-picker");
const checkoutForm = $("#checkout-form");
const paymentOptions = $("#payment-options");
const amountInput = $("#amount");
const amountWrap = $("#amount-wrap");
const quickAmounts = $("#quick-amounts");
const songFieldWrap = $("#song-field-wrap");
const songInput = $("#song");
const nameInput = $("#customer-name");
const emailInput = $("#customer-email");
const noteInput = $("#note");
const continueButton = $("#continue-button");
const statusEl = $("#status");
const intentBadge = $("#intent-badge");
const successPanel = $("#success-panel");
const successCopy = $("#success-copy");
const successConfirmation = $("#success-confirmation");

let config;
let intent = null;
let squarePayments = null;
let card = null;
let cashAppPay = null;
let paymentUiInitialized = false;

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.add("visible");
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.classList.remove("visible");
}

function showRow(id) {
  const row = document.getElementById(id);
  if (row) row.classList.remove("hidden");
}

function dollarsToCents(value) {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid payment amount.");
  return Math.round(n * 100);
}

function centsToDollars(cents) {
  return (Number(cents) / 100).toFixed(2);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadScript(src) {
  await new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((s) => s.src === src);
    if (existing) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function setModeUI(mode) {
  modePicker.classList.add("hidden");
  checkoutForm.classList.remove("hidden");

  if (mode === "tip") {
    pageTitle.textContent = "TIP RICK";
    pageSubtitle.textContent = "Thank you for supporting the music.";
    quickAmounts.classList.remove("hidden");
  } else if (mode === "song") {
    pageTitle.textContent = "SONG REQUEST";
    pageSubtitle.textContent = "Send your request and payment together.";
    songFieldWrap.classList.remove("hidden");
    quickAmounts.classList.remove("hidden");
  } else if (mode === "vocal") {
    pageTitle.textContent = "VOCAL TUTORIAL";
    pageSubtitle.textContent = "Secure checkout for the Diamond Method course.";
    quickAmounts.classList.add("hidden");
    amountInput.readOnly = true;
  } else if (mode === "invoice") {
    pageTitle.textContent = "PAY INVOICE";
    pageSubtitle.textContent = "Secure invoice payment.";
    quickAmounts.classList.add("hidden");
    amountInput.readOnly = true;
  }
}

function fillIntentUI(currentIntent) {
  intent = currentIntent;
  amountInput.value = centsToDollars(intent.amountCents);
  amountInput.readOnly = true;
  quickAmounts.classList.add("hidden");

  intentBadge.innerHTML = [
    `<strong>${escapeHtml(intent.title)}</strong>`,
    intent.reference ? `<div>Reference: ${escapeHtml(intent.reference)}</div>` : "",
    intent.description ? `<div>${escapeHtml(intent.description)}</div>` : ""
  ].join("");
  intentBadge.classList.remove("hidden");

  if (intent.customerName) nameInput.value = intent.customerName;
  if (intent.customerEmail) emailInput.value = intent.customerEmail;

  if (intent.status === "PAID") {
    showSuccess(intent.providerPaymentId || intent.providerOrderId || intent.id);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function createPublicIntent(mode) {
  const body = {
    type: mode === "song" ? "song_request" : mode === "vocal" ? "vocal_tutorial" : "tip",
    customerName: nameInput.value.trim(),
    customerEmail: emailInput.value.trim(),
    note: noteInput.value.trim()
  };

  if (mode === "tip" || mode === "song") {
    body.amountCents = dollarsToCents(amountInput.value);
  }

  if (mode === "song") {
    if (!songInput.value.trim()) throw new Error("Enter the song you are requesting.");
    body.song = songInput.value.trim();
    if (params.get("songRequestId")) body.songRequestId = params.get("songRequestId");
  }

  return api("/api/intents/public", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function buildSquarePaymentRequest() {
  return squarePayments.paymentRequest({
    countryCode: "US",
    currencyCode: intent.currency,
    total: { amount: centsToDollars(intent.amountCents), label: intent.title }
  });
}

async function initializeSquare() {
  const squareSdk =
    config.square.environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";

  await loadScript(squareSdk);

  squarePayments = window.Square.payments(config.square.applicationId, config.square.locationId);

  card = await squarePayments.card();
  await card.attach("#card-container");

  $("#card-pay-button").onclick = async () => {
    try {
      showStatus("Opening secure card payment…");
      const tokenResult = await card.tokenize();
      if (tokenResult.status !== "OK") throw new Error("Card payment was not completed.");
      await paySquare(tokenResult.token);
    } catch (error) {
      showStatus(error.message || "Card payment failed.");
    }
  };

  try {
    const applePay = await squarePayments.applePay(buildSquarePaymentRequest());
    const target = $("#apple-pay-button");
    target.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Pay with Apple Pay";
    btn.onclick = async () => {
      try {
        const result = await applePay.tokenize();
        if (result.status !== "OK") throw new Error("Apple Pay was not completed.");
        await paySquare(result.token);
      } catch (error) {
        showStatus(error.message || "Apple Pay failed.");
      }
    };
    target.appendChild(btn);
    showRow("apple-pay-row");
  } catch (error) {
    console.info("Apple Pay unavailable:", error?.message || error);
  }

  try {
    const googlePay = await squarePayments.googlePay(buildSquarePaymentRequest());
    await googlePay.attach("#google-pay-button", { buttonColor: "black", buttonType: "long" });
    $("#google-pay-button").addEventListener("click", async () => {
      try {
        const result = await googlePay.tokenize();
        if (result.status !== "OK") throw new Error("Google Pay was not completed.");
        await paySquare(result.token);
      } catch (error) {
        showStatus(error.message || "Google Pay failed.");
      }
    });
    showRow("google-pay-row");
  } catch (error) {
    console.info("Google Pay unavailable:", error?.message || error);
  }

  try {
    const options = { redirectURL: window.location.href, referenceId: intent.id };
    cashAppPay = await squarePayments.cashAppPay(buildSquarePaymentRequest(), options);

    cashAppPay.addEventListener("ontokenization", async (event) => {
      const { tokenResult } = event.detail;
      if (tokenResult.status === "OK") {
        try { await paySquare(tokenResult.token); }
        catch (error) { showStatus(error.message || "Cash App Pay failed."); }
      } else if (tokenResult.status === "Cancel") {
        showStatus("Cash App payment was canceled.");
      } else {
        showStatus("Cash App payment could not be completed.");
      }
    });

    await cashAppPay.attach("#cash-app-pay-button", { shape: "semiround", width: "full" });
    showRow("cash-app-row");
  } catch (error) {
    console.info("Cash App Pay unavailable:", error?.message || error);
  }
}

async function paySquare(sourceId) {
  showStatus("Processing payment…");
  const result = await api("/api/square/pay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intentId: intent.id, sourceId })
  });
  showSuccess(result.paymentId);
}

async function initializePayPal() {
  if (!config.paypal.clientId) return;

  const qs = new URLSearchParams({
    "client-id": config.paypal.clientId,
    currency: intent.currency,
    components: "buttons",
    "enable-funding": "venmo"
  });

  await loadScript(`https://www.paypal.com/sdk/js?${qs}`);

  const sharedHandlers = {
    style: { shape: "rect", height: 48 },
    createOrder: async () => {
      clearStatus();
      const result = await api("/api/paypal/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intent.id })
      });
      return result.id;
    },

    onApprove: async (data) => {
      showStatus("Completing payment…");
      const result = await api(`/api/paypal/orders/${encodeURIComponent(data.orderID)}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intent.id })
      });
      showSuccess(result.id);
    },

    onError: (err) => {
      console.error(err);
      showStatus("Checkout could not be completed.");
    }
  };

  const paypalButtons = window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.PAYPAL,
    ...sharedHandlers
  });
  if (await paypalButtons.isEligible()) {
    await paypalButtons.render("#paypal-button-container");
    showRow("paypal-row");
  }

  const venmoButtons = window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.VENMO,
    ...sharedHandlers
  });
  if (await venmoButtons.isEligible()) {
    await venmoButtons.render("#venmo-button-container");
    showRow("venmo-row");
  }
}

async function initializePaymentUI() {
  if (paymentUiInitialized) return;
  paymentUiInitialized = true;
  continueButton.classList.add("hidden");
  paymentOptions.classList.remove("hidden");
  showStatus("Loading secure payment options…");

  const results = await Promise.allSettled([initializeSquare(), initializePayPal()]);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error("Payment provider init failed:", i === 0 ? "square" : "paypal", r.reason);
    }
  });
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length) {
    showStatus("Payment options could not be loaded. Please refresh and try again.");
  } else {
    clearStatus();
  }
}

function showSuccess(confirmation) {
  checkoutForm.classList.add("hidden");
  successPanel.classList.remove("hidden");
  successCopy.textContent =
    intent?.type === "song_request" ? "Your song request and payment were received." :
    intent?.type === "tip" ? "Thank you for the tip!" :
    intent?.type === "vocal_tutorial" ? "You're enrolled — your Diamond Method payment was received." :
    "Your payment was received.";
  successConfirmation.textContent = `Confirmation: ${confirmation || intent?.id || ""}`;
}

document.querySelectorAll("[data-amount]").forEach((button) => {
  button.addEventListener("click", () => {
    amountInput.value = Number(button.dataset.amount).toFixed(2);
  });
});

continueButton.addEventListener("click", async () => {
  try {
    clearStatus();

    if (!intent) {
      showStatus("Creating secure checkout…");
      const mode = params.get("mode") || "tip";
      const result = await createPublicIntent(mode);
      fillIntentUI(result.intent);
    }

    await initializePaymentUI();
  } catch (error) {
    showStatus(error.message || "Unable to start checkout.");
  }
});

async function boot() {
  config = await api("/api/config");
  const intentId = params.get("intent");
  const mode = params.get("mode");

  if (intentId) {
    setModeUI("invoice");
    const result = await api(`/api/intents/${encodeURIComponent(intentId)}`);
    fillIntentUI(result.intent);

    const mappedMode =
      intent.type === "song_request" ? "song" :
      intent.type === "vocal_tutorial" ? "vocal" :
      intent.type === "tip" ? "tip" :
      "invoice";

    setModeUI(mappedMode);
    continueButton.textContent = `Continue — $${centsToDollars(intent.amountCents)}`;
    return;
  }

  if (!mode) return;

  if (["tip", "song", "vocal"].includes(mode) === false) {
    location.href = "/pay/";
    return;
  }

  setModeUI(mode);

  if (mode === "vocal") {
    amountInput.value = centsToDollars(config.products.vocalTutorialPriceCents);
    continueButton.textContent = `Continue — $${centsToDollars(config.products.vocalTutorialPriceCents)}`;
  }
  if ((mode === "tip" || mode === "song") && params.get("amount")) {
    const presetAmt = Number(params.get("amount"));
    if (Number.isFinite(presetAmt) && presetAmt > 0) amountInput.value = presetAmt.toFixed(2);
  }
  if (mode === "song" && params.get("song")) {
    songInput.value = params.get("song");
  }
}

boot().catch((error) => {
  console.error(error);
  showStatus(error.message || "Unable to load checkout.");
});
