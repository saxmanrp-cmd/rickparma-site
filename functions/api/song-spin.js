function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function nextSpinPosition(env) {
  if (!env.PAYMENT_DB) throw new Error("PAYMENT_DB is not configured.");

  await env.PAYMENT_DB.prepare(`
    CREATE TABLE IF NOT EXISTS song_spin_state (
      id INTEGER PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `).run();

  const now = new Date().toISOString();
  await env.PAYMENT_DB.prepare(`
    INSERT OR IGNORE INTO song_spin_state (id, position, updated_at)
    VALUES (1, 0, ?)
  `).bind(now).run();

  // One shared seven-spin cycle for the live site. The first six positions are
  // BOGO and position seven is FREE, then the cycle starts over at one.
  // UPDATE ... RETURNING keeps the increment and returned position atomic even
  // when multiple guests spin at nearly the same time.
  const row = await env.PAYMENT_DB.prepare(`
    UPDATE song_spin_state
    SET position = CASE WHEN position >= 7 THEN 1 ELSE position + 1 END,
        updated_at = ?
    WHERE id = 1
    RETURNING position
  `).bind(now).first();

  const position = Number(row && row.position);
  if (!Number.isInteger(position) || position < 1 || position > 7) {
    throw new Error("Could not advance song spin cycle.");
  }
  return position;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "allow": "POST, OPTIONS",
        "cache-control": "no-store"
      }
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const position = await nextSpinPosition(env);
    return json({ outcome: position === 7 ? "FREE" : "BOGO" });
  } catch (error) {
    console.error("Song spin error", error);
    return json({ error: error.message || "Unable to determine spin outcome." }, 500);
  }
}
