// whatitpaid-app — API worker for whatitpaid.com.
// Handles /api/notify (KV-backed email capture). Called cross-origin from
// the Pages site, so CORS is enabled for whatitpaid.com.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ORIGINS = [
  "https://whatitpaid.com",
  "https://www.whatitpaid.com",
  "https://whatitpaid.pages.dev",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/api/notify" && request.method === "POST") {
      const res = await handleNotify(request, env);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    return json({ ok: false, error: "not_found" }, 404, cors);
  },
};

async function handleNotify(request, env) {
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

function json(obj, status = 200, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  return new Response(JSON.stringify(obj), { status, headers });
}
