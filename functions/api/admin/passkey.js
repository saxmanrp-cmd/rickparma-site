const COOKIE = '__Host-payhub_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const RP_ID = 'rickparma.com';
const ORIGIN = 'https://rickparma.com';

export function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 8192) throw new Error('Invalid credential data.');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export async function digest(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
function random(size = 32) { return crypto.getRandomValues(new Uint8Array(size)); }
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function adminKey(request, env) {
  const header = request.headers.get('authorization') || '';
  return Boolean(env.ADMIN_API_KEY && header === `Bearer ${env.ADMIN_API_KEY}`);
}
async function setup(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS payhub_passkeys (
    credential_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS payhub_challenges (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, ip TEXT, setup_hash TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS payhub_sessions (
    token_hash TEXT PRIMARY KEY, credential_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS payhub_setup_links (
    token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`).run();
}
export async function isPayHubAdmin(request, env) {
  if (adminKey(request, env)) return true;
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[A-Za-z0-9_-]{40,50}$/.test(token) || !env.PAYMENT_DB) return false;
  try {
    const hash = base64url(await digest(decode64(token)));
    const row = await env.PAYMENT_DB.prepare('SELECT 1 FROM payhub_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(hash, Date.now()).first();
    return Boolean(row);
  } catch (_) { return false; }
}
async function issueChallenge(db, kind, request, setupHash = null) {
  await db.prepare('DELETE FROM payhub_challenges WHERE expires_at < ?').bind(Date.now()).run();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip) {
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM payhub_challenges WHERE ip = ? AND created_at > ?')
      .bind(ip, Date.now() - 5 * 60 * 1000).first();
    if (Number(recent?.n || 0) >= 12) throw new Error('Too many attempts. Please wait five minutes.');
  }
  const id = crypto.randomUUID(), challenge = base64url(random());
  await db.prepare('INSERT INTO payhub_challenges (id, challenge, kind, expires_at, created_at, ip, setup_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, challenge, kind, Date.now() + 5 * 60 * 1000, Date.now(), ip, setupHash).run();
  return { id, challenge };
}
async function consumeChallenge(db, id, kind) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid challenge.');
  const row = await db.prepare('DELETE FROM payhub_challenges WHERE id = ? AND kind = ? RETURNING challenge, expires_at, setup_hash')
    .bind(id, kind).first();
  if (!row || row.expires_at <= Date.now()) throw new Error('Passkey challenge expired. Please try again.');
  return row;
}
function clientData(encoded, type, challenge) {
  const raw = decode64(encoded);
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.type !== type || data.challenge !== challenge || data.origin !== ORIGIN || data.crossOrigin === true) {
    throw new Error('Passkey challenge or website did not match.');
  }
  return raw;
}
async function authenticatorData(encoded, registration = false) {
  const bytes = decode64(encoded);
  if (bytes.length < (registration ? 55 : 37)) throw new Error('Invalid authenticator data.');
  const expected = await digest(new TextEncoder().encode(RP_ID));
  if (!expected.every((value, i) => bytes[i] === value)) throw new Error('Passkey belongs to another website.');
  if ((bytes[32] & 0x05) !== 0x05 || (registration && !(bytes[32] & 0x40))) {
    throw new Error('Face ID or device verification is required.');
  }
  const count = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  return { bytes, count };
}
// WebAuthn authenticators return ASN.1 DER ECDSA signatures; WebCrypto expects fixed-width r||s.
function signatureToRaw(encoded) {
  const der = decode64(encoded);
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('Invalid signature.');
  let length = der[i++];
  if (length & 0x80) {
    if (length !== 0x81) throw new Error('Invalid signature.');
    length = der[i++];
  }
  if (i + length !== der.length) throw new Error('Invalid signature.');
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) throw new Error('Invalid signature.');
    const n = der[i++];
    if (n < 1 || n > 33 || i + n > der.length) throw new Error('Invalid signature.');
    let value = der.slice(i, i + n); i += n;
    if (value.length === 33) { if (value[0] !== 0) throw new Error('Invalid signature.'); value = value.slice(1); }
    out.set(value, part * 32 + 32 - value.length);
  }
  if (i !== der.length) throw new Error('Invalid signature.');
  return out;
}

export async function onRequestGet({ request, env }) {
  return json({ authenticated: await isPayHubAdmin(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (new URL(request.url).origin !== ORIGIN || request.headers.get('origin') !== ORIGIN) {
    return json({ error: 'Open the Pay Hub on rickparma.com.' }, 403);
  }
  if (!env.PAYMENT_DB) return json({ error: 'Payment database is unavailable.' }, 503);
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Invalid request.' }, 400); }
  const action = body?.action;
  if (!['setup-link','register-options','register-finish','login-options','login-finish','logout'].includes(action)) return json({ error: 'Invalid action.' }, 400);
  try {
    const db = env.PAYMENT_DB;
    if (action === 'setup-link' && !adminKey(request, env)) return json({ error: 'Open the Pay Hub in the browser where you are already signed in.' }, 401);
    await setup(db);
    if (action === 'setup-link') {
      await db.prepare('DELETE FROM payhub_setup_links WHERE expires_at < ?').bind(Date.now()).run();
      const token = random(), encoded = base64url(token);
      await db.prepare('INSERT INTO payhub_setup_links (token_hash, expires_at) VALUES (?, ?)')
        .bind(base64url(await digest(token)), Date.now() + 5 * 60 * 1000).run();
      return json({ token: encoded, expiresInSeconds: 300 });
    }
    if (action === 'register-options') {
      let setupHash = null;
      if (!adminKey(request, env)) {
        setupHash = base64url(await digest(decode64(body.setupToken)));
        const link = await db.prepare('SELECT 1 FROM payhub_setup_links WHERE token_hash = ? AND expires_at > ?')
          .bind(setupHash, Date.now()).first();
        if (!link) return json({ error: 'Setup link expired. Create a new one from your signed-in Pay Hub.' }, 401);
      }
      const { id, challenge } = await issueChallenge(db, 'register', request, setupHash);
      const rows = await db.prepare('SELECT credential_id FROM payhub_passkeys').all();
      return json({ id, publicKey: { challenge, rp: { id: RP_ID, name: 'Rick Parma Pay Hub' },
        user: { id: base64url(new TextEncoder().encode('rick-parma-payhub-admin')), name: 'Rick Parma', displayName: 'Rick Parma' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 300000, attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: (rows.results || []).map(row => ({ type: 'public-key', id: row.credential_id })) } });
    }
    if (action === 'register-finish') {
      const pending = await consumeChallenge(db, body.id, 'register');
      if (pending.setup_hash) {
        const suppliedHash = base64url(await digest(decode64(body.setupToken)));
        if (suppliedHash !== pending.setup_hash) throw new Error('Setup link did not match.');
      } else if (!adminKey(request, env)) return json({ error: 'Passkey setup needs the original signed-in browser.' }, 401);
      clientData(body.clientDataJSON, 'webauthn.create', pending.challenge);
      const { bytes } = await authenticatorData(body.authenticatorData, true);
      const credentialLength = (bytes[53] << 8) | bytes[54];
      if (!credentialLength || credentialLength > 1024 || bytes.length < 55 + credentialLength) throw new Error('Invalid passkey ID.');
      const credentialId = base64url(bytes.slice(55, 55 + credentialLength));
      if (credentialId !== body.credentialId || body.algorithm !== -7) throw new Error('Passkey details did not match.');
      const publicKey = decode64(body.publicKey);
      await crypto.subtle.importKey('spki', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (pending.setup_hash) {
        const link = await db.prepare('DELETE FROM payhub_setup_links WHERE token_hash = ? AND expires_at > ? RETURNING token_hash')
          .bind(pending.setup_hash, Date.now()).first();
        if (!link) throw new Error('Setup link has expired or was already used.');
      }
      await db.prepare('INSERT INTO payhub_passkeys (credential_id, public_key, created_at) VALUES (?, ?, ?)')
        .bind(credentialId, body.publicKey, new Date().toISOString()).run();
      return json({ ok: true });
    }
    if (action === 'login-options') {
      const { id, challenge } = await issueChallenge(db, 'login', request);
      return json({ id, publicKey: { challenge, rpId: RP_ID, timeout: 300000, userVerification: 'required' } });
    }
    if (action === 'login-finish') {
      const pending = await consumeChallenge(db, body.id, 'login');
      const client = clientData(body.clientDataJSON, 'webauthn.get', pending.challenge);
      const { bytes, count } = await authenticatorData(body.authenticatorData);
      const credential = await db.prepare('SELECT public_key, sign_count FROM payhub_passkeys WHERE credential_id = ?')
        .bind(body.credentialId).first();
      if (!credential) throw new Error('This passkey is not registered.');
      const key = await crypto.subtle.importKey('spki', decode64(credential.public_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const signed = new Uint8Array(bytes.length + 32);
      signed.set(bytes); signed.set(await digest(client), bytes.length);
      const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureToRaw(body.signature), signed);
      if (!valid || (credential.sign_count > 0 && count > 0 && count <= credential.sign_count)) throw new Error('Passkey verification failed.');
      await db.prepare('UPDATE payhub_passkeys SET sign_count = ? WHERE credential_id = ?')
        .bind(Math.max(count, credential.sign_count), body.credentialId).run();
      const token = random(), encoded = base64url(token), tokenHash = base64url(await digest(token));
      await db.prepare('DELETE FROM payhub_sessions WHERE expires_at < ?').bind(Date.now()).run();
      await db.prepare('INSERT INTO payhub_sessions (token_hash, credential_id, expires_at) VALUES (?, ?, ?)')
        .bind(tokenHash, body.credentialId, Date.now() + SESSION_MS).run();
      return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${encoded}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
    }
    if (action === 'logout') {
      const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim())
        .find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (token && /^[A-Za-z0-9_-]{40,50}$/.test(token)) {
        await db.prepare('DELETE FROM payhub_sessions WHERE token_hash = ?').bind(base64url(await digest(decode64(token)))).run();
      }
      return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
    }
  } catch (error) {
    console.error('Pay Hub passkey error', error);
    return json({ error: error?.message || 'Passkey request failed.' }, 400);
  }
}
