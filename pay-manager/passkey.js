(() => {
  const endpoint = '/api/admin/passkey';
  const text = id => document.getElementById(id);
  const from64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  const to64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let setupToken = new URL(location.href).hash.match(/^#setup=([A-Za-z0-9_-]{43})$/)?.[1] || '';
  if (setupToken) history.replaceState(null, '', location.pathname + location.search);

  async function call(action, body = {}, key = '') {
    const res = await fetch(endpoint, { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ action, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Passkey request failed.');
    return data;
  }

  async function register(key = '', token = '') {
    const { id, publicKey } = await call('register-options', { setupToken: token }, key);
    const credential = await navigator.credentials.create({ publicKey: {
      ...publicKey, challenge: from64(publicKey.challenge),
      user: { ...publicKey.user, id: from64(publicKey.user.id) },
      excludeCredentials: publicKey.excludeCredentials.map(item => ({ ...item, id: from64(item.id) }))
    } });
    if (!credential) throw new Error('Passkey setup was cancelled.');
    const response = credential.response;
    const publicKeyBytes = response.getPublicKey?.();
    const authData = response.getAuthenticatorData?.();
    if (!publicKeyBytes || !authData) throw new Error('This browser cannot create a compatible passkey. Use Safari.');
    await call('register-finish', { id, setupToken: token, credentialId: to64(credential.rawId),
      clientDataJSON: to64(response.clientDataJSON), authenticatorData: to64(authData),
      publicKey: to64(publicKeyBytes), algorithm: response.getPublicKeyAlgorithm?.() }, key);
  }

  async function login() {
    const { id, publicKey } = await call('login-options');
    const credential = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: from64(publicKey.challenge) } });
    if (!credential) throw new Error('Passkey sign-in was cancelled.');
    await call('login-finish', { id, credentialId: to64(credential.rawId),
      clientDataJSON: to64(credential.response.clientDataJSON),
      authenticatorData: to64(credential.response.authenticatorData),
      signature: to64(credential.response.signature) });
  }

  window.PayHubPasskeys = {
    async session() {
      try { const r = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' }); return r.ok && (await r.json()).authenticated; }
      catch (_) { return false; }
    },
    async logout() { try { await call('logout'); } catch (_) {} },
    init({ getKey, onLogin }) {
      const supported = Boolean(window.PublicKeyCredential && navigator.credentials);
      const loginButton = text('passkeyLoginBtn');
      const setupButton = text('setupFromLinkBtn');
      if (!supported) {
        loginButton.disabled = true;
        text('passkeyMessage').textContent = 'Passkeys are unavailable in this browser. Open the Pay Hub in Safari.';
        return;
      }
      if (setupToken) {
        setupButton.classList.remove('hidden');
        text('passkeyMessage').textContent = 'Create a passkey with Face ID on this iPhone. The setup link expires after five minutes.';
      }
      loginButton.addEventListener('click', async () => {
        loginButton.disabled = true;
        text('passkeyMessage').textContent = 'Waiting for Face ID…';
        try { await login(); text('passkeyMessage').textContent = ''; await onLogin(); }
        catch (e) { text('passkeyMessage').textContent = e.message; }
        finally { loginButton.disabled = false; }
      });
      setupButton.addEventListener('click', async () => {
        setupButton.disabled = true;
        text('passkeyMessage').textContent = 'Waiting for Face ID…';
        try { await register('', setupToken); setupToken = ''; setupButton.classList.add('hidden');
          text('passkeyMessage').textContent = 'Passkey saved. Tap Sign in with Face ID / Passkey.'; }
        catch (e) { text('passkeyMessage').textContent = e.message; }
        finally { setupButton.disabled = false; }
      });
      text('addPasskeyBtn').addEventListener('click', async () => {
        const key = getKey();
        if (!key) { text('setupStatus').textContent = 'Add another passkey from the browser that still has your original admin-key login.'; return; }
        text('addPasskeyBtn').disabled = true;
        try { await register(key); text('setupStatus').textContent = 'Passkey saved. You can now sign in with Face ID.'; }
        catch (e) { text('setupStatus').textContent = e.message; }
        finally { text('addPasskeyBtn').disabled = false; }
      });
      text('setupSafariBtn').addEventListener('click', async () => {
        const key = getKey();
        if (!key) { text('setupStatus').textContent = 'Open the Pay Hub browser where you signed in with the admin key.'; return; }
        text('setupSafariBtn').disabled = true;
        try {
          const { token } = await call('setup-link', {}, key);
          const url = `https://rickparma.com/pay-manager/#setup=${token}`;
          try { await navigator.clipboard.writeText(url); text('setupStatus').textContent = 'Setup link copied. Paste it into Safari on your iPhone within five minutes, then tap Create Safari Passkey.'; }
          catch (_) { text('setupStatus').textContent = `Copy this link into Safari within five minutes: ${url}`; }
        } catch (e) { text('setupStatus').textContent = e.message; }
        finally { text('setupSafariBtn').disabled = false; }
      });
    }
  };
})();
