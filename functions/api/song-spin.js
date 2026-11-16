const SETTINGS_URL = 'https://rickparma-jsonbin-proxy.saxmanrp.workers.dev/songs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'
  }});
}

async function spinSettings() {
  const response = await fetch(SETTINGS_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('Song settings unavailable.');
  return (await response.json()).record || {};
}

async function createTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS song_spin_cycles (
    cycle_id TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS song_spin_devices (
    cycle_id TEXT NOT NULL, device_id TEXT NOT NULL, request_id TEXT NOT NULL,
    song_id TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'PENDING',
    token TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (cycle_id, device_id)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS song_spin_rewards (
    cycle_id TEXT NOT NULL, device_id TEXT NOT NULL, milestone INTEGER NOT NULL,
    request_id TEXT NOT NULL, song_id TEXT NOT NULL, token TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY (cycle_id, device_id, milestone)
  )`).run();
}

async function repeatSpin(db, { cycleId, deviceId, requestId, songId, now }) {
  const previous = await db.prepare(`SELECT request_id, outcome, token FROM song_spin_devices
    WHERE cycle_id = ? AND device_id = ?`).bind(cycleId, deviceId).first();
  if (previous?.request_id === requestId && previous.outcome !== 'PENDING')
    return { outcome: previous.outcome, token: previous.token || undefined, cycleId };

  const replay = await db.prepare(`SELECT token FROM song_spin_rewards
    WHERE cycle_id = ? AND device_id = ? AND request_id = ?`)
    .bind(cycleId, deviceId, requestId).first();
  if (replay) return { outcome: 'FREE', token: replay.token, cycleId };

  // Only completed performance checkouts count. A BOGO checkout is one paid
  // request, even though it contains two songs. DJ checkouts never count.
  const paid = await db.prepare(`SELECT COUNT(*) AS total FROM payment_intents
    WHERE type = 'song_request' AND status = 'PAID'
      AND provider IN ('square', 'paypal') AND provider_payment_id IS NOT NULL AND provider_payment_id != ''
      AND json_extract(metadata_json, '$.spinDeviceId') = ?
      AND json_extract(metadata_json, '$.spinCycleId') = ?
      AND COALESCE(json_extract(metadata_json, '$.requestType'), '') != 'dj'`)
    .bind(deviceId, cycleId).first();
  const earned = Math.floor(Number(paid?.total || 0) / 4);
  if (!earned) return { outcome: 'PAID', cycleId };
  const claimed = await db.prepare(`SELECT COUNT(*) AS total FROM song_spin_rewards
    WHERE cycle_id = ? AND device_id = ?`).bind(cycleId, deviceId).first();
  const milestone = Number(claimed?.total || 0) + 1;
  if (milestone > earned) return { outcome: 'PAID', cycleId };

  const token = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT OR IGNORE INTO song_spin_rewards
    (cycle_id, device_id, milestone, request_id, song_id, token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(cycleId, deviceId, milestone, requestId, songId, token, now).run();
  if (inserted.meta?.changes !== 1) return { outcome: 'PAID', cycleId };
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS song_free_spin_claims (
      token TEXT PRIMARY KEY, song_id TEXT NOT NULL, created_at TEXT NOT NULL, claimed_at TEXT
    )`).run();
    await db.prepare(`INSERT INTO song_free_spin_claims (token, song_id, created_at) VALUES (?, ?, ?)`)
      .bind(token, songId, now).run();
    return { outcome: 'FREE', token, cycleId };
  } catch (error) {
    await db.prepare(`DELETE FROM song_spin_rewards WHERE cycle_id = ? AND device_id = ? AND milestone = ?`)
      .bind(cycleId, deviceId, milestone).run();
    throw error;
  }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    if (!env.PAYMENT_DB) throw new Error('PAYMENT_DB is not configured.');
    const body = await request.json().catch(() => ({}));
    const songId = String(body.songId || '').trim().slice(0, 100);
    const deviceId = String(body.deviceId || '').trim();
    const requestId = String(body.requestId || '').trim();
    if (!songId || !/^[0-9a-f-]{36}$/i.test(deviceId) || !/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: 'Invalid spin request.' }, 400);

    const settings = await spinSettings();
    if (settings.songRequestLive === false || settings.performanceModeEnabled === false || settings.spinEnabled === false) return json({ error: 'Spins are closed.' }, 403);
    if (!(settings.songs || []).some(song => String(song.id) === songId)) return json({ error: 'Song is unavailable.' }, 400);
    const cycleId = String(settings.spinCycleId || 'legacy').slice(0, 100);
    await createTables(env.PAYMENT_DB);
    const now = new Date().toISOString();
    const inserted = await env.PAYMENT_DB.prepare(`INSERT OR IGNORE INTO song_spin_devices
      (cycle_id, device_id, request_id, song_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(cycleId, deviceId, requestId, songId, now).run();
    if (inserted.meta?.changes !== 1) {
      return json(await repeatSpin(env.PAYMENT_DB, { cycleId, deviceId, requestId, songId, now }));
    }

    try {
      await env.PAYMENT_DB.prepare(`INSERT OR IGNORE INTO song_spin_cycles (cycle_id, position) VALUES (?, 0)`).bind(cycleId).run();
      // This single update assigns one shared position, even for concurrent guests.
      const row = await env.PAYMENT_DB.prepare(`UPDATE song_spin_cycles
        SET position = CASE WHEN position >= 10 THEN 1 ELSE position + 1 END
        WHERE cycle_id = ? RETURNING position`).bind(cycleId).first();
      if (!row) throw new Error('Could not advance song spin cycle.');
      const outcome = Number(row.position) === 10 ? 'FREE' : 'BOGO';
      let token = null;
      if (outcome === 'FREE') {
        await env.PAYMENT_DB.prepare(`CREATE TABLE IF NOT EXISTS song_free_spin_claims (
          token TEXT PRIMARY KEY, song_id TEXT NOT NULL, created_at TEXT NOT NULL, claimed_at TEXT
        )`).run();
        token = crypto.randomUUID();
        await env.PAYMENT_DB.prepare(`INSERT INTO song_free_spin_claims (token, song_id, created_at) VALUES (?, ?, ?)`)
          .bind(token, songId, now).run();
      }
      await env.PAYMENT_DB.prepare(`UPDATE song_spin_devices SET outcome = ?, token = ?
        WHERE cycle_id = ? AND device_id = ?`).bind(outcome, token, cycleId, deviceId).run();
      return json({ outcome, token: token || undefined, cycleId });
    } catch (error) {
      // The claim can be retried when the cycle could not be advanced.
      await env.PAYMENT_DB.prepare(`DELETE FROM song_spin_devices WHERE cycle_id = ? AND device_id = ? AND outcome = 'PENDING'`)
        .bind(cycleId, deviceId).run();
      throw error;
    }
  } catch (error) {
    console.error('Song spin error', error);
    return json({ error: 'Unable to determine spin outcome. Please try again.' }, 503);
  }
}
