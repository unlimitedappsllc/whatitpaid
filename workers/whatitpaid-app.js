const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ORIGINS = [
  "https://whatitpaid.com",
  "https://www.whatitpaid.com",
  "https://whatitpaid.pages.dev",
];

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