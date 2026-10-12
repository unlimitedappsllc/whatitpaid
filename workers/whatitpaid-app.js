const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ORIGINS = [
  "https://whatitpaid.com",
  "https://www.whatitpaid.com",
  "https://whatitpaid.pages.dev",
];

// ============================================================================
// CHECKOUT + MAGIC-LINK EXTENSION (added 2026-10-12, test-mode ready)
// ----------------------------------------------------------------------------
// NOT YET DEPLOYED to production. Deployment plan (Bryant, 2026-10-12): this
// extended Worker is first deployed to a SEPARATE test Worker with its own
// test KV namespace, and only promoted to the production `whatitpaid-app`
// Worker at launch. Therefore NOTHING new below is hardcoded to production:
//   - env.SITE_BASE_URL — base for success/cancel URLs and magic links
//     (defaults to https://whatitpaid.com; the test Worker sets it to its
//     own URL so test magic links resolve against the test deployment)
//   - env.STRIPE_SECRET_KEY    (Worker secret; Stripe TEST key in testing)
//   - env.STRIPE_WEBHOOK_SECRET (Worker secret, from the webhook endpoint)
//   - env.PRICE_RECEIPT_01..05, PRICE_3PACK, PRICE_LIBRARY (plain env vars
//     holding Stripe Price IDs — swapping test<->live is config-only)
//   - KV always via the NOTIFY_KV binding (whichever namespace is bound)
// While STRIPE_SECRET_KEY is absent, /api/checkout and /api/stripe-webhook
// return 503 {"error":"checkout_not_configured"} and every pre-existing
// route behaves exactly as before.
// Specs: checkout-build-spec.md, magic-link-access-design.md,
// referral-tracking-system-design.md (goal files dir).
// ============================================================================

// Base URL for everything the new routes link to (site pages + /read links).
function siteBase(env) {
  return (env.SITE_BASE_URL || "https://whatitpaid.com").replace(/\/+$/, "");
}
const RECEIPT_IDS = [
  "receipt-01", "receipt-02", "receipt-03",
  "receipt-04", "receipt-05",
];
// Curated starter trios (bundle-3pack-spec.md): trio id -> fixed receipt ids.
// Placeholder membership until the catalog locks; price is PRICE_3PACK either way.
const TRIO_RECEIPTS = {
  "starter": ["receipt-01", "receipt-02", "receipt-03"],
};
const RECEIPT_NAMES = {
  "receipt-01": "Receipt 01 — TikTok Shop AI Characters",
  "receipt-02": "Receipt 02 — AI Food Photos for Restaurants",
  "receipt-03": "Receipt 03 — AI Prompt Service",
  "receipt-04": "Receipt 04 — Short Product Videos",
  "receipt-05": "Receipt 05 — AI Characters + Affiliate Links",
  "library": "The Full Library (every Receipt, forever)",
};
const MAGIC_TTL_SECONDS = 90 * 24 * 3600;   // magic token lifetime: 90 days
const SESSION_COOKIE_SECONDS = 24 * 3600;   // /read session cookie: 24h
const RESEND_RATE_LIMIT = 5;                // magic-link re-sends per email per hour
const TOKEN_RE = /^[0-9a-f]{64}$/;

function confirmHtml(email) {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're on the list — What It Paid</title>
<style>
:root { color-scheme: light; supported-color-schemes: light; }
@media (prefers-color-scheme: dark) {
  body, .email-bg, table[class="email-bg"] { background-color: #f4efe3 !important; }
  .header-bg { background-color: #f4efe3 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4efe3;-webkit-text-size-adjust:100%;">
<center>
<table width="100%" cellpadding="0" cellspacing="0" border="0"  class="email-bg" style="background-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48v4xAAWhAscyctgoAAAAAElFTkSuQmCC);background-repeat:repeat;background-color:#f4efe3;">
<tr><td align="center" style="padding:32px 16px;">

<!-- Card -->
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:26px;overflow:hidden;">
<!-- Header -->
<tr><td align="center" style="background-color:#f4efe3;padding:32px 24px;">
<img src="https://whatitpaid.com/assets/img/logo-master.png" alt="What It Paid" width="320" style="display:block;width:320px;max-width:80%;height:auto;border:0;">
</td></tr>
<!-- Body -->
<tr><td style="padding:40px 36px 32px;font-family:'Nunito',Arial,sans-serif;color:#1a1713;">
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;">You're on the list. 🧾</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;">
Thanks for signing up. You'll get one email each time a new receipt drops — the method, the real numbers, the hidden costs, and the verdict. No spam, no fluff.
</p>
<p style="margin:0 0 28px;font-size:16px;line-height:1.7;">
Each receipt is a hands-on workbook: worksheets, trackers, and a 30-day plan so you can run the method yourself.
</p>
<!-- Bulletproof button -->
<table cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 28px;">
<tr>
<td align="center" bgcolor="#35a852" style="border-radius:12px;">
<a href="https://whatitpaid.com/" target="_blank" style="display:inline-block;padding:16px 36px;font-family:'Nunito',Arial,sans-serif;font-size:17px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px;">Browse the receipts</a>
</td>
</tr>
</table>
</td></tr>
<!-- Footer -->
<tr><td style="padding:0 36px 36px;font-family:'Nunito',Arial,sans-serif;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#8a8171;">
One email per new receipt. <a href="https://whatitpaid-app.roject--undred-old.workers.dev/api/unsubscribe?email=${encodeURIComponent(email)}" style="color:#35a852;text-decoration:underline;">Unsubscribe anytime</a>.<br>
<span style="color:#35a852;font-weight:700;">What It Paid</span> by Unlimited Apps
</p>
</td></tr>
</table>
<!-- /Card -->

<p style="font-family:'Nunito',Arial,sans-serif;font-size:12px;color:#b9b09a;margin:24px 0 0;">
whatitpaid.com
</p>

</td></tr>
</table>
</center>
</body>
</html>
`;
}


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

    if (url.pathname === "/api/unsubscribe" && request.method === "GET") {
      const email = (url.searchParams.get("email") || "").trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) {
        return new Response(unsubPage("That link doesn't look right.", false), {
          headers: { "content-type": "text/html; charset=utf-8" } });
      }
      const key = `email:${email}`;
      const existing = await env.NOTIFY_KV.get(key);
      if (existing) {
        const data = JSON.parse(existing);
        data.unsubscribed = true;
        data.unsubscribed_ts = new Date().toISOString();
        await env.NOTIFY_KV.put(key, JSON.stringify(data));
      }
      // Send unsubscribe confirmation email
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "What It Paid <hello@whatitpaid.com>",
            to: [email],
            subject: "Unsubscribed — What It Paid",
            html: unsubConfirmHtml(),
            text: "You've been unsubscribed from What It Paid receipt alerts. No more emails will be sent. Changed your mind? Resubscribe at https://whatitpaid.com",
          }),
        });
      } catch (e) { /* don't fail the page on email error */ }
      return new Response(unsubPage(email, true), {
        headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/checkout" && request.method === "POST") {
      const res = await handleCheckout(request, env);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    if (url.pathname === "/checkout/success" && request.method === "GET") {
      return new Response(checkoutSuccessPage(env), {
        headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    if (url.pathname === "/api/magic-link/resend" && request.method === "POST") {
      const res = await handleMagicResend(request, env);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    if (url.pathname === "/read" || url.pathname.startsWith("/read/")) {
      if (request.method === "GET") {
        const token = url.pathname.slice("/read/".length).replace(/\/.*$/, "");
        return handleRead(request, env, TOKEN_RE.test(token) ? token : null);
      }
    }

    return json({ ok: false, error: "not_found" }, 404, cors);
  },
};

function unsubPage(email, success) {
  const msg = success
    ? `<p style="font-size:18px;color:#f4efe3;">You&apos;ve been unsubscribed.</p><p style="color:#a8a094;">No more receipt alerts will be sent to <strong>${email}</strong>.</p>`
    : `<p style="font-size:18px;color:#f4efe3;">${email}</p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe - What It Paid</title></head><body style="margin:0;padding:40px 20px;background:#1a1713;font-family:sans-serif;text-align:center;"><div style="max-width:480px;margin:0 auto;"><p style="font-size:28px;color:#f4efe3;margin-bottom:16px;">What It Paid</p>${msg}<p style="margin-top:32px;"><a href="https://whatitpaid.com" style="color:#35a852;">Back to whatitpaid.com</a></p></div></body></html>`;
}

function unsubConfirmHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:40px 20px;background:#f4efe3;font-family:Arial,sans-serif;"><center><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f4efe3;"><tr><td style="padding:36px;text-align:center;"><p style="font-size:24px;color:#1a1713;margin:0 0 16px;"><strong>What It Paid</strong></p><p style="font-size:16px;color:#1a1713;line-height:1.6;">You&apos;ve been unsubscribed.</p><p style="font-size:14px;color:#5a5347;line-height:1.6;">No more receipt alerts will be sent to this address.<br>Changed your mind? <a href="https://whatitpaid.com" style="color:#35a852;">Resubscribe anytime</a>.</p><p style="margin-top:32px;font-size:13px;color:#8a8171;"><span style="color:#35a852;font-weight:700;">What It Paid</span> by Unlimited Apps</p></td></tr></table></center></body></html>`;
}

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
  const isNew = !existing;
  if (isNew) {
    await env.NOTIFY_KV.put(
      key,
      JSON.stringify({ email, ts: new Date().toISOString(), source })
    );
    // Send confirmation (non-blocking for the response; log failures)
    if (env.RESEND_API_KEY) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "What It Paid <hello@whatitpaid.com>",
            to: [email],
            subject: "You're on the list — What It Paid",
            html: confirmHtml(email),
            text: "You're on the list! You'll get one email each time a new receipt drops. Browse: https://whatitpaid.com",
          }),
        });
        if (r.ok) {
          await env.NOTIFY_KV.put(
            key,
            JSON.stringify({ email, ts: new Date().toISOString(), source, confirm_sent: true })
          );
        } else {
          console.log("Resend rejected confirmation:", await r.text());
        }
      } catch (e) {
        console.log("Resend send failed:", e.message);
      }
    }
  }
  return json({ ok: true });
}

function json(obj, status = 200, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  return new Response(JSON.stringify(obj), { status, headers });
}

// ============================================================================
// Checkout + magic-link implementation (see banner above the constants).
// ============================================================================

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function getBuyer(env, email) {
  const raw = await env.NOTIFY_KV.get(`buyer:${email}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveBuyer(env, buyer) {
  await env.NOTIFY_KV.put(`buyer:${buyer.email}`, JSON.stringify(buyer));
}

async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.log("sendEmail skipped (no RESEND_API_KEY):", subject);
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "What It Paid <hello@whatitpaid.com>",
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!r.ok) console.log("Resend rejected email:", subject, await r.text());
  return r.ok;
}

// --- POST /api/checkout -----------------------------------------------------

function priceEnvFor(receiptId) {
  return "PRICE_" + receiptId.replace(/-/g, "_").toUpperCase();
}

async function handleCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: "checkout_not_configured" }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  let receiptIds = null;
  let lineItems = null;
  const singlePrice = (priceId) => [{ price: priceId, quantity: 1 }];

  if (body.bundle === "3pack-choice") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length !== 3 || new Set(items).size !== 3 ||
        !items.every((id) => RECEIPT_IDS.includes(id))) {
      return json({ ok: false, error: "invalid_bundle_selection" }, 400);
    }
    if (!env.PRICE_3PACK) return json({ ok: false, error: "checkout_not_configured" }, 503);
    receiptIds = items;
    lineItems = singlePrice(env.PRICE_3PACK);
  } else if (typeof body.bundle === "string" && body.bundle.startsWith("3pack-trio-")) {
    const trio = TRIO_RECEIPTS[body.bundle.slice("3pack-trio-".length)];
    if (!trio) return json({ ok: false, error: "invalid_bundle" }, 400);
    if (!env.PRICE_3PACK) return json({ ok: false, error: "checkout_not_configured" }, 503);
    receiptIds = trio;
    lineItems = singlePrice(env.PRICE_3PACK);
  } else if (body.bundle === "library") {
    if (!env.PRICE_LIBRARY) return json({ ok: false, error: "checkout_not_configured" }, 503);
    receiptIds = ["library"];
    lineItems = singlePrice(env.PRICE_LIBRARY);
  } else if (Array.isArray(body.items) && body.items.length > 0) {
    if (!body.items.every((id) => RECEIPT_IDS.includes(id))) {
      return json({ ok: false, error: "invalid_items" }, 400);
    }
    lineItems = [];
    for (const id of body.items) {
      const priceId = env[priceEnvFor(id)];
      if (!priceId) return json({ ok: false, error: "checkout_not_configured" }, 503);
      lineItems.push({ price: priceId, quantity: 1 });
    }
    receiptIds = body.items;
  } else {
    return json({ ok: false, error: "empty_order" }, 400);
  }

  const referralCode = body.referral_code
    ? String(body.referral_code).slice(0, 16) : null;

  const base = siteBase(env);
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${base}/checkout/success`);
  // Per-Receipt catalog anchors can replace this once buy buttons are wired.
  params.set("cancel_url", `${base}/receipts`);
  lineItems.forEach((li, i) => {
    params.set(`line_items[${i}][price]`, li.price);
    params.set(`line_items[${i}][quantity]`, String(li.quantity));
  });
  params.set("payment_intent_data[statement_descriptor_suffix]", "WHATITPAID");
  params.set("payment_intent_data[metadata][product_line]", "whatitpaid");
  params.set("payment_intent_data[metadata][receipt_ids]", receiptIds.join(","));
  params.set("metadata[product_line]", "whatitpaid");
  params.set("metadata[receipt_ids]", receiptIds.join(","));
  if (referralCode) params.set("metadata[referral_code]", referralCode);
  // Lifetime-updates opt-in (checkout-build-spec.md): collected as a Stripe
  // Checkout custom field — a pre-selected dropdown ("yes" is the default
  // value, matching the pre-checked checkbox in the design) rather than an
  // on-our-site checkbox, so consent state lands on the completed session
  // and rides the webhook. Values: yes | no.
  params.set("custom_fields[0][key]", "updates_opt_in");
  params.set("custom_fields[0][type]", "dropdown");
  params.set("custom_fields[0][label][type]", "custom");
  params.set("custom_fields[0][label][custom]", "Email me free lifetime updates for this Receipt");
  params.set("custom_fields[0][dropdown][options][0][label]", "Yes, email me free lifetime updates");
  params.set("custom_fields[0][dropdown][options][0][value]", "yes");
  params.set("custom_fields[0][dropdown][options][1][label]", "No updates, just my purchase");
  params.set("custom_fields[0][dropdown][options][1][value]", "no");
  params.set("custom_fields[0][dropdown][default_value]", "yes");
  params.set("custom_fields[0][optional]", "false");
  const emailHint = String(body.email_hint || "").trim().toLowerCase();
  if (EMAIL_RE.test(emailHint)) params.set("customer_email", emailHint);

  let session;
  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    session = await r.json();
    if (!r.ok || !session.url) {
      console.log("Stripe session create failed:", session?.error?.message || r.status);
      return json({ ok: false, error: "checkout_unavailable" }, 502);
    }
  } catch (e) {
    console.log("Stripe session create error:", e.message);
    return json({ ok: false, error: "checkout_unavailable" }, 502);
  }
  return json({ ok: true, url: session.url });
}

// --- POST /api/stripe-webhook ----------------------------------------------

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = {};
  for (const kv of sigHeader.split(",")) {
    const idx = kv.indexOf("=");
    if (idx > 0) parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5-min tolerance
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return json({ ok: false, error: "checkout_not_configured" }, 503);
  }
  const payload = await request.text();
  const ok = await verifyStripeSignature(
    payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET
  );
  if (!ok) return json({ ok: false, error: "bad_signature" }, 400);

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ ok: false, error: "bad_payload" }, 400);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      if (s.payment_status === "paid") await onCheckoutCompleted(env, s);
    } else if (event.type === "charge.refunded") {
      await onChargeRefunded(env, event.data.object);
    }
  } catch (e) {
    console.log("webhook handler error:", event.type, e.message);
    return json({ ok: false, error: "handler_error" }, 500); // Stripe retries
  }
  return json({ ok: true, received: true });
}

async function onCheckoutCompleted(env, s) {
  const paymentIntent = s.payment_intent;
  // Idempotency (checkout-build-spec.md): a retried webhook must not mint a
  // second token or double-count a referral.
  if (paymentIntent) {
    const seen = await env.NOTIFY_KV.get(`processed:${paymentIntent}`);
    if (seen) return;
  }
  const email = String(
    s.customer_details?.email || s.customer_email || ""
  ).trim().toLowerCase();
  const receiptIds = String(s.metadata?.receipt_ids || "")
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (!email || receiptIds.length === 0) {
    console.log("checkout.session.completed missing email/receipt_ids; skipping");
    return;
  }
  const optInField = (s.custom_fields || [])
    .find((f) => f.key === "updates_opt_in");
  await completePurchase(env, {
    email,
    receiptIds,
    paymentIntent,
    orderId: s.id,
    referralCode: s.metadata?.referral_code || null,
    updatesOptIn: optInField?.dropdown?.value !== "no",
  });
  if (paymentIntent) {
    await env.NOTIFY_KV.put(
      `processed:${paymentIntent}`,
      JSON.stringify({
        email,
        receipt_ids: receiptIds,
        order_id: s.id,
        referral_code: s.metadata?.referral_code || null,
        processed_at: new Date().toISOString(),
      })
    );
  }
}

// --- Purchase completion (shared by the Stripe webhook) ---------------------

async function completePurchase(env, { email, receiptIds, orderId, referralCode, updatesOptIn }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + MAGIC_TTL_SECONDS * 1000).toISOString();
  const token = newToken();

  const buyer = (await getBuyer(env, email)) || {
    email, receipt_ids: [], tokens: [], created_at: nowIso,
  };
  const owned = new Set(buyer.receipt_ids || []);
  for (const id of receiptIds) owned.add(id);
  buyer.receipt_ids = [...owned];
  buyer.tokens = [...(buyer.tokens || []), token];
  buyer.updates_opt_in = !!updatesOptIn;
  if (referralCode && !buyer.referred_by) buyer.referred_by = referralCode;
  buyer.updated_at = nowIso;
  const ownCode = await ensureReferralCode(env, buyer);
  await saveBuyer(env, buyer);

  await env.NOTIFY_KV.put(
    `magic:${token}`,
    JSON.stringify({
      email, receipt_ids: receiptIds,
      purchased_at: nowIso, expires_at: expiresIso,
    }),
    { expirationTtl: MAGIC_TTL_SECONDS }
  );

  if (referralCode) {
    await attributeReferral(env, { code: referralCode, email, receiptIds, orderId });
  }
  await sendMagicLinkEmail(env, {
    email, token, receiptIds,
    referralCode: ownCode, subject: "Your Receipt is ready — What It Paid",
  });
  console.log("purchase complete:", email, receiptIds.join(","), "token", token.slice(0, 8));
}

// One unguessable 8-char code per buyer (referral design: generated at
// purchase, never sequential, never derived from the email).
async function ensureReferralCode(env, buyer) {
  if (buyer.referral_code) return buyer.referral_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(6))).slice(0, 8);
    const existing = await env.NOTIFY_KV.get(`refcode:${code}`);
    if (!existing) {
      await env.NOTIFY_KV.put(
        `refcode:${code}`,
        JSON.stringify({ owner_email: buyer.email, created_at: new Date().toISOString() })
      );
      buyer.referral_code = code;
      return code;
    }
  }
  return null;
}

// Attribution at purchase time (referral design Flow 2). A purchase counts
// once per referred buyer no matter how many Receipts are in the order —
// a bundle is one referred buyer.
async function attributeReferral(env, { code, email, receiptIds, orderId }) {
  const ownerRaw = await env.NOTIFY_KV.get(`refcode:${code}`);
  if (!ownerRaw) return; // unknown code: no attribution
  const ownerEmail = JSON.parse(ownerRaw).owner_email;

  let counted = true;
  let reason = null;
  if (ownerEmail === email) { counted = false; reason = "self_referral"; }

  const logKey = `referrals:${code}`;
  const log = JSON.parse((await env.NOTIFY_KV.get(logKey)) || '{"attributed":[]}');
  if (counted && log.attributed.some((a) => a.email === email && a.counted)) {
    counted = false; reason = "duplicate_email";
  }
  const entry = {
    email, receipt: receiptIds.join(","),
    purchased_at: new Date().toISOString(), order_id: orderId,
    refunded: false, counted,
  };
  if (reason) entry.reason = reason;
  log.attributed.push(entry);
  await env.NOTIFY_KV.put(logKey, JSON.stringify(log));
  if (!counted) return;

  const qualifying = log.attributed.filter((a) => a.counted && !a.refunded).length;
  if (qualifying > 0 && qualifying % 3 === 0) {
    const owner = await getBuyer(env, ownerEmail);
    if (!owner) return;
    const rewardId = "rwd_" + newToken().slice(0, 16);
    await env.NOTIFY_KV.put(`reward:${rewardId}`, JSON.stringify({
      reward_id: rewardId, owner_email: ownerEmail,
      earned_at: new Date().toISOString(), triggering_order: orderId,
      status: "earned", claimed_receipt: null, claimed_at: null,
    }));
    owner.rewards_earned = (owner.rewards_earned || 0) + 1;
    owner.updated_at = new Date().toISOString();
    await saveBuyer(env, owner);
    await sendEmail(env, {
      to: ownerEmail,
      subject: "You earned a free Receipt — What It Paid",
      html: rewardEmailHtml(),
      text: "Three people bought through your referral link — you've earned a free Receipt. Reply to this email to claim any Receipt you don't own yet.",
    });
  }
}

// --- Refunds -----------------------------------------------------------------

async function onChargeRefunded(env, charge) {
  const pi = charge.payment_intent;
  if (!pi) return;
  const raw = await env.NOTIFY_KV.get(`processed:${pi}`);
  if (!raw) {
    console.log("refund: no purchase record for payment_intent", pi);
    return;
  }
  const marker = JSON.parse(raw);
  const email = marker.email;
  const refundedIds = marker.receipt_ids || [];

  const buyer = await getBuyer(env, email);
  if (buyer) {
    buyer.receipt_ids = (buyer.receipt_ids || [])
      .filter((id) => !refundedIds.includes(id));
    for (const t of buyer.tokens || []) {
      const recRaw = await env.NOTIFY_KV.get(`magic:${t}`);
      if (!recRaw) continue;
      const rec = JSON.parse(recRaw);
      const kept = (rec.receipt_ids || []).filter((id) => !refundedIds.includes(id));
      if (kept.length === 0) {
        await env.NOTIFY_KV.delete(`magic:${t}`);
      } else {
        // Note: re-putting restarts the token's 90-day TTL (acceptable).
        await env.NOTIFY_KV.put(
          `magic:${t}`, JSON.stringify({ ...rec, receipt_ids: kept }),
          { expirationTtl: MAGIC_TTL_SECONDS }
        );
      }
    }
    // If nothing is owned anymore, invalidate all tokens.
    if (buyer.receipt_ids.length === 0) {
      for (const t of buyer.tokens || []) await env.NOTIFY_KV.delete(`magic:${t}`);
      buyer.tokens = [];
    }
    buyer.updated_at = new Date().toISOString();
    await saveBuyer(env, buyer);
  }

  // Referral recount (referral design Flow 3): mark the attribution
  // refunded/uncounted. NOTE: revoking an already-earned-but-unclaimed
  // reward when the count drops below a threshold is intentionally NOT
  // automated in v1 — flagged for Bryant's review before live launch.
  if (marker.referral_code) {
    const logKey = `referrals:${marker.referral_code}`;
    const logRaw = await env.NOTIFY_KV.get(logKey);
    if (logRaw) {
      const log = JSON.parse(logRaw);
      let changed = false;
      for (const a of log.attributed) {
        if (a.order_id === marker.order_id && !a.refunded) {
          a.refunded = true; a.counted = false; changed = true;
        }
      }
      if (changed) await env.NOTIFY_KV.put(logKey, JSON.stringify(log));
    }
  }
  console.log("refund processed:", email, refundedIds.join(","));
}

// --- Emails (branded like the existing confirmation family) ------------------

async function sendMagicLinkEmail(env, { email, token, receiptIds, referralCode, subject }) {
  const link = `${siteBase(env)}/read/${token}`;
  const names = receiptIds.map((id) => RECEIPT_NAMES[id] || id);
  const listHtml = names.map((n) => `<li style="margin:0 0 6px;">${escapeHtml(n)}</li>`).join("");
  const referralHtml = referralCode
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;">
         Your referral link: <a href="${siteBase(env)}/?ref=${referralCode}" style="color:#35a852;">${siteBase(env)}/?ref=${referralCode}</a><br>
         Share it — when 3 people buy through it, you pick any Receipt free.
       </p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Receipt is ready — What It Paid</title>
</head>
<body style="margin:0;padding:0;background-color:#f4efe3;-webkit-text-size-adjust:100%;">
<center>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4efe3;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:26px;overflow:hidden;">
<tr><td align="center" style="background-color:#f4efe3;padding:32px 24px;">
<img src="https://whatitpaid.com/assets/img/logo-master.png" alt="What It Paid" width="320" style="display:block;width:320px;max-width:80%;height:auto;border:0;">
</td></tr>
<tr><td style="padding:40px 36px 32px;font-family:'Nunito',Arial,sans-serif;color:#1a1713;">
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;">Your Receipt is ready. 🧾</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.7;">
Thanks for your purchase — no account, no password. This one link opens everything you own:
</p>
<ul style="margin:0 0 24px;padding-left:20px;font-size:16px;line-height:1.7;">${listHtml}</ul>
<table cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 28px;">
<tr>
<td align="center" bgcolor="#35a852" style="border-radius:12px;">
<a href="${link}" target="_blank" style="display:inline-block;padding:16px 36px;font-family:'Nunito',Arial,sans-serif;font-size:17px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px;">Open your Receipt</a>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#5a5347;">
Or paste this link into your browser:<br>${link}
</p>
${referralHtml}
</td></tr>
<tr><td style="padding:0 36px 36px;font-family:'Nunito',Arial,sans-serif;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#8a8171;">
This link expires in 90 days. Need a new one? Reply to this email.<br>
<span style="color:#35a852;font-weight:700;">What It Paid</span> by Unlimited Apps
</p>
</td></tr>
</table>
<p style="font-family:'Nunito',Arial,sans-serif;font-size:12px;color:#b9b09a;margin:24px 0 0;">
whatitpaid.com
</p>
</td></tr>
</table>
</center>
</body>
</html>`;
  const text =
    `Your Receipt is ready — What It Paid\n\n` +
    `You bought:\n${names.map((n) => `- ${n}`).join("\n")}\n\n` +
    `Open everything you own (no account, no password):\n${link}\n\n` +
    `This link expires in 90 days. Need a new one? Reply to this email.` +
    (referralCode
      ? `\n\nYour referral link: ${siteBase(env)}/?ref=${referralCode}\nShare it — when 3 people buy through it, you pick any Receipt free.`
      : "");
  await sendEmail(env, { to: email, subject, html, text });
}

function rewardEmailHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:40px 20px;background:#f4efe3;font-family:Arial,sans-serif;"><center><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f4efe3;"><tr><td style="padding:36px;text-align:center;"><p style="font-size:24px;color:#1a1713;margin:0 0 16px;"><strong>What It Paid</strong></p><p style="font-size:16px;color:#1a1713;line-height:1.6;">You earned a free Receipt. 🎉</p><p style="font-size:14px;color:#5a5347;line-height:1.6;">Three people bought through your referral link. Reply to this email with the Receipt you want, and we'll add it to your library.</p><p style="margin-top:32px;font-size:13px;color:#8a8171;"><span style="color:#35a852;font-weight:700;">What It Paid</span> by Unlimited Apps</p></td></tr></table></center></body></html>`;
}

// --- GET /read/{token} --------------------------------------------------------

async function readTokenRecord(env, token) {
  if (!token) return null;
  const raw = await env.NOTIFY_KV.get(`magic:${token}`);
  if (!raw) return null;
  const rec = JSON.parse(raw);
  if (new Date(rec.expires_at).getTime() <= Date.now()) return null;
  return rec;
}

async function handleRead(request, env, token) {
  const htmlHeaders = { "content-type": "text/html; charset=utf-8" };
  let rec = await readTokenRecord(env, token);
  let viaCookie = false;
  if (!rec) {
    const m = (request.headers.get("cookie") || "")
      .match(/(?:^|;\s*)wip_session=([0-9a-f]{64})/);
    if (m) {
      rec = await readTokenRecord(env, m[1]);
      viaCookie = !!rec;
      if (rec) token = m[1];
    }
  }
  if (!rec) {
    return new Response(expiredPage(env), { status: 200, headers: htmlHeaders });
  }
  // One link unlocks everything the buyer owns (locked decision): show the
  // buyer record's full ownership, not just this token's purchase.
  const buyer = await getBuyer(env, rec.email);
  const owned = buyer?.receipt_ids?.length ? buyer.receipt_ids : rec.receipt_ids;
  const headers = { ...htmlHeaders };
  if (!viaCookie && token) {
    headers["set-cookie"] =
      `wip_session=${token}; Path=/read; Max-Age=${SESSION_COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
  }
  return new Response(readerPage(env, rec.email, owned), { headers });
}

function readerPage(env, email, ownedIds) {
  const items = ownedIds
    .map((id) => `<li style="margin:0 0 10px;font-size:17px;">${escapeHtml(RECEIPT_NAMES[id] || id)}</li>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your library — What It Paid</title></head><body style="margin:0;padding:40px 20px;background:#f4efe3;font-family:sans-serif;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:26px;padding:40px 36px;"><p style="font-size:26px;font-weight:800;color:#1a1713;margin:0 0 8px;">Your library 🧾</p><p style="color:#5a5347;font-size:15px;margin:0 0 24px;">Signed in as ${escapeHtml(email)} — this is everything you own:</p><ul style="padding-left:20px;color:#1a1713;">${items}</ul><p style="color:#8a8171;font-size:13px;line-height:1.6;margin-top:28px;">TEST BUILD — gated access verified. The interactive flip-book reader ships with the first Receipt launch; this page proves the magic-link gate works end to end.</p><p style="margin-top:20px;"><a href="${siteBase(env)}" style="color:#35a852;">whatitpaid.com</a></p></div></body></html>`;
}

function expiredPage(env) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired — What It Paid</title></head><body style="margin:0;padding:40px 20px;background:#1a1713;font-family:sans-serif;text-align:center;"><div style="max-width:480px;margin:0 auto;"><p style="font-size:28px;color:#f4efe3;margin-bottom:16px;">What It Paid</p><p style="font-size:18px;color:#f4efe3;">This link has expired.</p><p style="color:#a8a094;">Enter the email you bought with and we'll send a fresh link.</p><form id="resend-form" style="margin-top:24px;"><input type="email" name="email" required placeholder="you@example.com" style="padding:12px 16px;border-radius:10px;border:0;font-size:16px;width:70%;max-width:300px;"><br><button type="submit" style="margin-top:14px;padding:12px 28px;border-radius:10px;border:0;background:#35a852;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Send me a new link</button></form><p id="resend-msg" style="color:#35a852;margin-top:16px;"></p><p style="margin-top:32px;"><a href="${siteBase(env)}" style="color:#35a852;">Back to whatitpaid.com</a></p></div><script>document.getElementById("resend-form").addEventListener("submit",async(e)=>{e.preventDefault();const email=new FormData(e.target).get("email");try{await fetch("/api/magic-link/resend",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});}catch(_){}document.getElementById("resend-msg").textContent="If this email has purchases, a new link is on its way.";});</script></body></html>`;
}

// --- GET /checkout/success ------------------------------------------------------
// Stripe redirects the buyer here after payment (success_url in
// handleCheckout). Static confirmation only: purchase completion itself runs
// through the webhook -> magic-link email path, so this page makes no
// per-purchase claims. Support contact matches the mail convention used by
// every sender in this file (hello@whatitpaid.com; the magic-link email tells
// buyers to reply for a fresh link).

function checkoutSuccessPage(env) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment received — What It Paid</title></head><body style="margin:0;padding:40px 20px;background:#f4efe3;font-family:sans-serif;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:26px;padding:40px 36px;"><p style="font-size:26px;font-weight:800;color:#1a1713;margin:0 0 8px;">Payment received 🧾</p><p style="color:#5a5347;font-size:15px;line-height:1.7;margin:0 0 16px;">Thanks — your payment went through. Your access link is on its way to the email address you used at checkout.</p><p style="color:#5a5347;font-size:15px;line-height:1.7;margin:0 0 16px;">That one link opens your library — everything you own, no account and no password. It stays good for 90 days, and you can always get a fresh one.</p><p style="color:#5a5347;font-size:15px;line-height:1.7;margin:0;">Don&apos;t see it in a few minutes? Check your spam or promotions folder. Still nothing? Email us at <a href="mailto:hello@whatitpaid.com" style="color:#35a852;">hello@whatitpaid.com</a> and we&apos;ll sort it out.</p><p style="margin-top:20px;"><a href="${siteBase(env)}" style="color:#35a852;">whatitpaid.com</a></p></div></body></html>`;
}

// --- POST /api/magic-link/resend ----------------------------------------------
// Always returns { ok: true } for well-formed requests (no enumeration).
// Rate limit: 5 per email per hour via an hourly KV counter bucket.

async function handleMagicResend(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: true });

  const bucket = Math.floor(Date.now() / 3600000);
  const rlKey = `rl:resend:${email}:${bucket}`;
  const count = parseInt((await env.NOTIFY_KV.get(rlKey)) || "0", 10);
  if (count < RESEND_RATE_LIMIT) {
    await env.NOTIFY_KV.put(rlKey, String(count + 1), { expirationTtl: 3600 });
    const buyer = await getBuyer(env, email);
    if (buyer && (buyer.receipt_ids || []).length > 0) {
      // Revoke old tokens, issue exactly one fresh link (design policy).
      for (const t of buyer.tokens || []) await env.NOTIFY_KV.delete(`magic:${t}`);
      const now = new Date();
      const token = newToken();
      await env.NOTIFY_KV.put(
        `magic:${token}`,
        JSON.stringify({
          email, receipt_ids: buyer.receipt_ids,
          purchased_at: now.toISOString(),
          expires_at: new Date(now.getTime() + MAGIC_TTL_SECONDS * 1000).toISOString(),
        }),
        { expirationTtl: MAGIC_TTL_SECONDS }
      );
      buyer.tokens = [token];
      buyer.updated_at = now.toISOString();
      await saveBuyer(env, buyer);
      await sendMagicLinkEmail(env, {
        email, token, receiptIds: buyer.receipt_ids,
        referralCode: null, subject: "Your new link — What It Paid",
      });
      console.log("magic link re-sent:", email, "token", token.slice(0, 8));
    }
  }
  return json({ ok: true });
}
