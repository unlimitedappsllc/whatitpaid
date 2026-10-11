// POST /api/notify — captures email signups for new-receipt notifications.
// Requires a KV binding named NOTIFY_KV on the Pages project.
// Stores: email -> { email, ts, source } ; dupes are idempotent.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost({ request, env }) {
  if (!env.NOTIFY_KV) {
    return json({ ok: false, error: "storage_unavailable" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const source = String(body.source || "notify-form").slice(0, 64);

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  const key = `email:${email}`;
  const existing = await env.NOTIFY_KV.get(key);
  if (!existing) {
    await env.NOTIFY_KV.put(
      key,
      JSON.stringify({ email, ts: new Date().toISOString(), source })
    );
  }
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
