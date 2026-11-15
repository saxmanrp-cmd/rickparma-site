import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { base64url, digest, onRequestGet, onRequestPost } from '../functions/api/admin/passkey.js';
import { onRequestGet as listTransactions } from '../functions/api/admin/transactions.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  return { sql, db: { prepare(query) { const statement = sql.prepare(query); return {
    bind(...values) { return { async first() { return statement.get(...values); }, async all() { return { results: statement.all(...values) }; }, async run() { return statement.run(...values); } }; },
    async first() { return statement.get(); }, async run() { return statement.run(); }, async all() { return { results: statement.all() }; }
  }; } } };
}
function post(env, action, body = {}, headers = {}) {
  return onRequestPost({ env, request: new Request('https://rickparma.com/api/admin/passkey', {
    method: 'POST', headers: { origin: 'https://rickparma.com', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ action, ...body })
  }) });
}
function clientData(type, challenge, origin = 'https://rickparma.com') {
  return base64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin })));
}
function authData(id, registration = false) {
  const credential = id || new Uint8Array();
  const data = new Uint8Array(registration ? 55 + credential.length : 37);
  data.set(new Uint8Array(32)); // replaced below with the RP hash
  data[32] = registration ? 0x45 : 0x05;
  if (registration) { data[53] = credential.length >> 8; data[54] = credential.length & 255; data.set(credential, 55); }
  return data;
}
function der(raw) {
  const integer = chunk => { let start = 0; while (start < chunk.length - 1 && chunk[start] === 0) start++;
    let value = chunk.slice(start); if (value[0] & 0x80) value = Uint8Array.from([0, ...value]);
    return Uint8Array.from([2, value.length, ...value]); };
  const a = integer(raw.slice(0, 32)), b = integer(raw.slice(32));
  return Uint8Array.from([0x30, a.length + b.length, ...a, ...b]);
}

test('Safari setup link creates a verified passkey, signs in, and grants only the Pay Hub session', async () => {
  const { sql, db } = database();
  const env = { PAYMENT_DB: db, ADMIN_API_KEY: 'existing-admin-key' };
  const keyAuth = { authorization: 'Bearer existing-admin-key' };
  try {
    const denied = await post(env, 'setup-link');
    assert.equal(denied.status, 401);
    const setup = await (await post(env, 'setup-link', {}, keyAuth)).json();
    const options = await (await post(env, 'register-options', { setupToken: setup.token })).json();
    const id = crypto.getRandomValues(new Uint8Array(32));
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const regAuth = authData(id, true); regAuth.set(await digest(new TextEncoder().encode('rickparma.com')));
    const registration = { id: options.id, setupToken: setup.token, credentialId: base64url(id),
      clientDataJSON: clientData('webauthn.create', options.publicKey.challenge),
      authenticatorData: base64url(regAuth), publicKey: base64url(spki), algorithm: -7 };
    const wrongOrigin = await post(env, 'register-finish', { ...registration,
      clientDataJSON: clientData('webauthn.create', options.publicKey.challenge, 'https://other.example') });
    assert.equal(wrongOrigin.status, 400, await wrongOrigin.text());
    const fresh = await (await post(env, 'register-options', { setupToken: setup.token })).json();
    registration.id = fresh.id;
    registration.clientDataJSON = clientData('webauthn.create', fresh.publicKey.challenge);
    assert.equal((await post(env, 'register-finish', registration)).status, 200);
    assert.equal((await post(env, 'register-options', { setupToken: setup.token })).status, 401);

    const loginOptions = await (await post(env, 'login-options')).json();
    const assertionData = authData(); assertionData.set(await digest(new TextEncoder().encode('rickparma.com')));
    const assertionClient = clientData('webauthn.get', loginOptions.publicKey.challenge);
    const clientHash = await digest(new TextEncoder().encode(JSON.stringify({ type:'webauthn.get', challenge:loginOptions.publicKey.challenge, origin:'https://rickparma.com' })));
    const signed = Uint8Array.from([...assertionData, ...clientHash]);
    const signature = der(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed)));
    const invalidOptions = await (await post(env, 'login-options')).json();
    const invalid = await post(env, 'login-finish', { id: invalidOptions.id, credentialId: base64url(id),
      clientDataJSON: clientData('webauthn.get', invalidOptions.publicKey.challenge),
      authenticatorData: base64url(assertionData), signature: base64url(signature) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('set-cookie'), null);
    const result = await post(env, 'login-finish', { id: loginOptions.id, credentialId: base64url(id),
      clientDataJSON: assertionClient, authenticatorData: base64url(assertionData), signature: base64url(signature) });
    assert.equal(result.status, 200);
    assert.equal((await post(env, 'login-finish', { id: loginOptions.id })).status, 400);
    const cookie = result.headers.get('set-cookie').split(';')[0];
    const authenticated = await onRequestGet({ env, request: new Request('https://rickparma.com/api/admin/passkey', { headers: { cookie } }) });
    assert.equal((await authenticated.json()).authenticated, true);
    sql.exec('CREATE TABLE payment_intents (id TEXT, type TEXT, status TEXT, amount_cents INTEGER, paid_at TEXT, provider TEXT, provider_payment_id TEXT); CREATE TABLE payment_events (intent_id TEXT, payload_json TEXT, created_at TEXT);');
    const sales = await listTransactions({ env, request: new Request('https://rickparma.com/api/admin/transactions', { headers: { cookie } }) });
    assert.equal(sales.status, 200);
    assert.equal((await post(env, 'logout', {}, { cookie })).status, 200);
    const expired = await onRequestGet({ env, request: new Request('https://rickparma.com/api/admin/passkey', { headers: { cookie } }) });
    assert.equal((await expired.json()).authenticated, false);
  } finally { sql.close(); }
});
