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
const passwordFieldWrap = $("#password-field-wrap");
const passwordInput = $("#password");
const confirmPasswordFieldWrap = $("#confirm-password-field-wrap");
const confirmPasswordInput = $("#confirm-password");
const nameInput = $("#customer-name");
const emailInput = $("#customer-email");
const noteInput = $("#note");
const continueButton = $("#continue-button");
const statusEl = $("#status");
const intentBadge = $("#intent-badge");
const successPanel = $("#success-panel");
const successCopy = $("#success-copy");
const successConfirmation = $("#success-confirmation");
const successActions = $("#success-actions");

let config;
let intent = null;
let squarePayments = null;
let card = null;
let cashAppPay = null;
let paymentUiInitialized = false;

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.toggle("visible", Boolean(message));
}

function showRow(id) {
  const row = document.getElementById(id);
  if (row) row.classList.remove("hidden");
}

function centsToDollars(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function dollarsToCents(value) {
  const n = Math.round(Number(value || 0) * 100);
  return Number.isFinite(n) ? n : 0;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadScript(src, timeoutMs = 8000) {
    await new Promise((resolve, reject) => {
          const existing = [...document.scripts].find((s) => s.src === src);
          if (existing) return resolve();
          const script = document.createElement("script");
          script.src = src;
          const timer = setTimeout(() => {
                  reject(new Error("Timed out loading " + src + ". Check your network connection."));
          }, timeoutMs);
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); reject(new Error("Failed to load " + src)); };
          document.head.appendChild(script);
    });
}

function setModeUI(mode) {
  modePicker.classList.add("hidden");
  checkoutForm.classList.remove("hidden");

  songFieldWrap.classList.add("hidden");
  passwordFieldWrap.classList.add("hidden");
  confirmPasswordFieldWrap.classList.add("hidden");
  emailInput.required = false;

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
    pageSubtitle.textContent = "Create your account and pay in one step.";
    quickAmounts.classList.add("hidden");
    amountInput.readOnly = true;
    passwordFieldWrap.classList.remove("hidden");
    confirmPasswordFieldWrap.classList.remove("hidden");
    emailInput.required = true;
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

  if (mode === "vocal") {
    if (!body.customerEmail) throw new Error("Enter your email to enroll.");
    const pw = passwordInput.value;
    const confirmPw = confirmPasswordInput.value;
    if (!pw || pw.length < 6) throw new Error("Password must be at least 6 characters.");
    if (pw !== confirmPw) throw new Error("Passwords do not match.");
    body.password = pw;
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

console.info("Square init diagnostics", {
      appId: config.square.applicationId,
      appIdType: typeof config.square.applicationId,
      appIdLength: config.square.applicationId ? config.square.applicationId.length : null,
      locationId: config.square.locationId,
      locationIdType: typeof config.square.locationId,
      locationIdLength: config.square.locationId ? config.square.locationId.length : null,
      language: navigator.language,
      languages: navigator.languages,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      secureContext: window.isSecureContext,
      squareExists: Boolean(window.Square),
      paymentsType: typeof (window.Square && window.Square.payments)
});
    squarePayments = window.Square.payments(String(config.square.applicationId), String(config.square.locationId));

try {
      card = await squarePayments.card();
      await card.attach("#card-container");

      $("#card-pay-button").addEventListener("click", async () => {
              try {
                        showStatus("Processing card payment…");
                        const result = await card.tokenize();
                        if (result.status === "OK") {
                                    await paySquare(result.token);
                        } else {
                                    showStatus("Card details could not be verified. Please check and try again.");
                        }
              } catch (error) {
                        showStatus(error.message || "Card payment failed.");
              }
      });
} catch (error) {
      console.info("Card element unavailable:", error?.message || error);
      const cardRowEl = document.getElementById("card-row");
      if (cardRowEl) cardRowEl.classList.add("hidden");
}

  try {
    const applePay = await squarePayments.applePay(buildSquarePaymentRequest());
    if (await applePay.canMakePayment?.()) {
      $("#apple-pay-button").addEventListener("click", async () => {
        try {
          const result = await applePay.tokenize();
          if (result.status === "OK") await paySquare(result.token);
        } catch (error) {
          showStatus(error.message || "Apple Pay failed.");
        }
      });
      showRow("apple-pay-row");
    }
  } catch (error) {
    console.info("Apple Pay unavailable:", error?.message || error);
  }

  try {
    const googlePay = await squarePayments.googlePay(buildSquarePaymentRequest());
    await googlePay.attach("#google-pay-button");
    googlePay.addEventListener("click", async () => {
      try {
        const result = await googlePay.tokenize();
        if (result.status !== "OK") throw new Error("Google Pay could not be completed.");
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
    // Cash App Pay can do a full-page redirect (desktop browsers without the app).
    // Point the return trip at ?intent=<id> so boot() can resume this exact intent
    // on reload and render the success screen (with working nav) instead of a
    // blank/default page with no way back.
    const resumeUrl = `${location.origin}${location.pathname}?intent=${encodeURIComponent(intent.id)}`;
    const options = { redirectURL: resumeUrl, referenceId: intent.id };
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
  showStatus("Confirming payment…");
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
    createOrder: async () => {
      const result = await api("/api/paypal/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intent.id })
      });
      return result.orderId;
    },
    onApprove: async (data) => {
      showStatus("Confirming PayPal payment…");
      const result = await api("/api/paypal/capture-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: intent.id })
      });
      showSuccess(result.id);
    },

    onError: (err) => {
      console.error(err);
      showStatus("PayPal payment could not be completed.");
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

  checkoutForm.classList.add("hidden");
  paymentOptions.classList.remove("hidden");
  amountWrap.classList.add("hidden");
  songFieldWrap.classList.add("hidden");
  passwordFieldWrap.classList.add("hidden");
  confirmPasswordFieldWrap.classList.add("hidden");
  document.querySelector('.field:has(#customer-name)')?.classList.add("hidden");
  document.querySelector('.field:has(#customer-email)')?.classList.add("hidden");
  document.querySelector('.field:has(#note)')?.classList.add("hidden");

  showStatus("");

let squareOk = true;
    let paypalOk = true;

    try {
          await initializeSquare();
    } catch (error) {
          squareOk = false;
          console.error("Square init failed", error);
    }

    try {
          await initializePayPal();
    } catch (error) {
          paypalOk = false;
          console.error("PayPal init failed", error);
    }

    if (!squareOk && !paypalOk) {
          showStatus("Payment options could not load. Check your internet connection and reload the page.");
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

  if (intent?.type === "vocal_tutorial") {
    if (successActions) successActions.classList.add("hidden");
    try {
      localStorage.setItem("dm_session", JSON.stringify({
        email: (intent.customerEmail || emailInput.value || "").trim().toLowerCase(),
        password: passwordInput.value
      }));
    } catch (_) {}
    setTimeout(() => { location.href = "/diamond-course.html"; }, 900);
  }
}

document.querySelectorAll("[data-amount]").forEach((button) => {
  button.addEventListener("click", () => {
    amountInput.value = Number(button.dataset.amount).toFixed(2);
  });
});

continueButton.addEventListener("click", async () => {
  try {
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
