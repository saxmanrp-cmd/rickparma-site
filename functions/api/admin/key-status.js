export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    adminKeyConfigured: Boolean(env.ADMIN_API_KEY)
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
