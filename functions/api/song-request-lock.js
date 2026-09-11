const PROXY_BASE = "https://rickparma-jsonbin-proxy.saxmanrp.workers.dev";
const LOCK_MS = 4 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function songLabel(song) {
  return `${song.t || ""}${song.a ? " - " + song.a : ""}`.trim();
}

function splitPaidSongLabels(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw.split(/\s+\+\s+BOGO:\s+/i).map((part) => part.trim()).filter(Boolean);
}

async function resolveSongIds(metadata, description) {
  const explicit = String(metadata?.songRequestId || "").trim();
  if (explicit) {
    const ids = explicit.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length) return [...new Set(ids)];
  }

  const paidLabel = metadata?.song || description || "";
  const wantedLabels = splitPaidSongLabels(paidLabel).map(normalize);
  if (!wantedLabels.length) return [];

  const songsRes = await fetch(`${PROXY_BASE}/songs`, { cache: "no-store" });
  if (!songsRes.ok) throw new Error(`Could not load songs (${songsRes.status}).`);
  const songsData = await songsRes.json();
  const songs = (songsData && songsData.record && songsData.record.songs) || [];

  const ids = [];
  for (const wanted of wantedLabels) {
    const exact = songs.find((song) => normalize(songLabel(song)) === wanted);
    const titleOnly = exact || songs.find((song) => normalize(song.t) === wanted);
    if (titleOnly && titleOnly.id) ids.push(String(titleOnly.id));
  }
  return [...new Set(ids)];
}

async function lockRequestedSongs(ids) {
  if (!ids.length) return [];

  const currentRes = await fetch(`${PROXY_BASE}/requested-songs`, { cache: "no-store" });
  const currentData = currentRes.ok ? await currentRes.json() : {};
  const map = (currentData && currentData.record && typeof currentData.record === "object")
    ? currentData.record
    : {};

  const now = Date.now();
  for (const key of Object.keys(map)) {
    const ts = Number(map[key] || 0);
    if (!ts || now - ts > LOCK_MS) delete map[key];
  }
  for (const id of ids) map[id] = now;

  const saveRes = await fetch(`${PROXY_BASE}/requested-songs`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(map)
  });
  if (!saveRes.ok) throw new Error(`Could not save requested-song lock (${saveRes.status}).`);
  return ids;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await request.json();
    const intentId = String(body?.intentId || "").trim();
    if (!intentId) return json({ error: "Missing intentId." }, 400);
    if (!env.PAYMENT_DB) return json({ error: "PAYMENT_DB is not configured." }, 500);

    const row = await env.PAYMENT_DB.prepare(`
      SELECT id, type, status, description, metadata_json
      FROM payment_intents
      WHERE id = ?
    `).bind(intentId).first();

    if (!row) return json({ error: "Payment intent not found." }, 404);
    if (row.type !== "song_request") return json({ error: "Not a song request." }, 400);
    if (row.status !== "PAID") return json({ ok: false, pending: true }, 202);

    const metadata = safeJsonParse(row.metadata_json, {});
    const ids = await resolveSongIds(metadata, row.description);
    if (!ids.length) {
      return json({ error: "Paid song could not be matched to the song list." }, 422);
    }

    await lockRequestedSongs(ids);
    return json({ ok: true, lockedSongIds: ids });
  } catch (error) {
    console.error("song-request-lock error", error);
    return json({ error: error.message || "Unable to lock requested song." }, 500);
  }
}
