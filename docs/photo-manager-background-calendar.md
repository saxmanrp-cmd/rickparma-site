# Photo Manager background Google Calendar setup

The new Cloudflare Pages Function at functions/api/photo-calendar/[[path]].js enables a one-time Google sign-in. Once connected, adding, editing and deleting show dates takes place server-side using an encrypted Google refresh token, without a Google account picker on every operation.

The integration is OFF until the Cloudflare production secrets below are configured. The current browser OAuth method remains available; it now caches a short-lived access token in memory so repeated same-session dates don't prompt each time.

## One-time setup

1. In Google Cloud Console, select the existing Rick Parma calendar (rick-parma-calendar) project. Under Google Auth Platform → Clients → Rick Parma Photo Manager (Web application), add this exact Authorized redirect URI:

   https://rickparma.com/api/photo-calendar/callback

   Keep the existing Authorized JavaScript origin https://rickparma.com.

2. The OAuth client secret appeared in an earlier screenshot. Rotate it before use. Never share, commit, or paste the new secret into chat.

3. In the Cloudflare Pages project that hosts rickparma.com, open Settings → Variables and Secrets, and add four encrypted production secrets:

   - PHOTO_CALENDAR_GOOGLE_CLIENT_ID — OAuth Web application client ID
   - PHOTO_CALENDAR_GOOGLE_CLIENT_SECRET — rotated OAuth client secret
   - PHOTO_CALENDAR_OWNER_EMAIL — Google email permitted to manage the Rick Parma Shows calendar
   - PHOTO_CALENDAR_TOKEN_KEY — unique random 32-byte AES-256 key, encoded as base64 or base64url

   Generate the last value privately on your Mac with: openssl rand -base64 32

   The function uses the already configured PAYMENT_DB D1 binding and creates separate rp_calendar_oauth_* tables, without modifying payment data. Make sure this binding exists in production. Redeploy the Pages project to apply the new secrets as needed.

4. In Google Auth Platform → Audience, verify your publishing status. External apps in Testing mode have refresh tokens that normally expire in 7 days for Calendar scopes. For longer-term background access, publish the app to In production and complete any Google verification Google requires. A new Google Personal mode app may be an alternative for single-user apps, but an existing External app cannot be converted to Personal.

5. Open https://rickparma.com/photo-manager and expand Settings — connections. When the server is configured, select Connect Google once. Sign in with the account matching PHOTO_CALENDAR_OWNER_EMAIL. The authorization returns to Photo Manager, creating a secure HttpOnly browser session.

6. Confirm Settings reports Connected. Save Show + Flyer, Save + Another Date, Edit Date and Delete Date should now save without Google login prompts.

## Security and behavior

- The server verifies the Google account email is verified and matches the configured owner.
- Authorization uses OAuth code flow with PKCE and a single-use state cookie.
- Google refresh tokens are encrypted with AES-GCM before D1 storage.
- Only authenticated same-origin requests are allowed to create, modify or delete calendar events.
- Sessions last up to 60 days per browser. If cookies are cleared or OAuth permission expires, connect once again.
- OAuth tokens and client secrets are never returned to the app.
- No existing Google Calendar events or flyer associations are changed by installing this code.
- The pre-existing client-side Google sign-in continues working until the backend is configured.

## Smoke test

Before setting secrets, GET /api/photo-calendar/status returns configured false, connected false.

After setting secrets but before connecting, it returns configured true, connected false.

After signing in once, it returns configured true, connected true. Changes in Photo Manager now go through the server endpoint /api/photo-calendar/events with secure cookies.

A code merge does not itself configure Google Cloud or Cloudflare secrets. Only a successful end-to-end authorization and test establishes live background functionality.
