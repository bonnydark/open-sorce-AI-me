const json = (data, status = 200) => Response.json(data, { status });
const plans = Object.freeze({
  pro: { label: "Pro", priceEnv: "STRIPE_PRICE_PRO_MONTHLY", requests: 2000 },
  business: { label: "Business", priceEnv: "STRIPE_PRICE_BUSINESS_MONTHLY", requests: 10000 }
});

function stripeConfigured(env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
async function stripeRequest(env, path, params, method = "POST") {
  const headers = { Authorization: "Bearer " + env.STRIPE_SECRET_KEY };
  let body;
  if (params && method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = params.toString();
  }
  const response = await fetch("https://api.stripe.com/v1/" + path, { method, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Stripe request failed (" + response.status + ").");
  return data;
}
function safeEqual(a, b) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(part => {
    const i = part.indexOf("=");
    return i > 0 ? [part.slice(0, i), part.slice(i + 1)] : ["", ""];
  }).filter(([k]) => k));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(timestamp) + "." + rawBody));
  const expected = [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return parts.v1.split(";").some(value => safeEqual(value, expected));
}
async function setUserSubscription(db, userId, { plan, customerId, subscriptionId, status, periodEnd }) {
  const paid = (status === "active" || status === "trialing") && plans[plan];
  await db.prepare(`
    UPDATE users SET plan=?, plan_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      stripe_customer_id=COALESCE(?,stripe_customer_id),
      stripe_subscription_id=?,
      stripe_subscription_status=?,
      stripe_current_period_end=?
    WHERE id=?
  `).bind(paid ? plan : "free", customerId || null, subscriptionId || null, status || "inactive", periodEnd || null, userId).run();
}
async function processSubscription(db, subscription) {
  const userId = subscription?.metadata?.user_id;
  const plan = subscription?.metadata?.plan;
  let user = userId ? await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first() : null;
  if (!user && subscription?.id) user = await db.prepare("SELECT id FROM users WHERE stripe_subscription_id=?").bind(subscription.id).first();
  if (!user) return;
  await setUserSubscription(db, user.id, {
    plan,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    subscriptionId: subscription.id || null,
    status: subscription.status || "inactive",
    periodEnd: subscription.current_period_end || null
  });
}

export async function handleBilling(request, env, user, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const path = url.pathname;
  if (path === "/api/billing/status" && request.method === "GET") {
    let row;
    try {
      row = await env.DB.prepare("SELECT plan,plan_updated_at,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,stripe_current_period_end FROM users WHERE id=?").bind(user.id).first();
    } catch {
      return json({ error: "Billing database migration is pending. Apply migrations before using billing." }, 503);
    }
    const plan = plans[row?.plan] ? row.plan : "free";
    return json({
      plan, planLabel: plans[plan]?.label || "Free",
      monthlyRequests: plan === "free" ? 100 : plans[plan].requests,
      subscriptionStatus: row?.stripe_subscription_status || "none",
      currentPeriodEnd: row?.stripe_current_period_end || null,
      canManageSubscription: Boolean(row?.stripe_customer_id),
      stripeConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO_MONTHLY && env.STRIPE_PRICE_BUSINESS_MONTHLY && env.STRIPE_WEBHOOK_SECRET),
      currencyNote: "Stripe displays available payment methods and supported currencies for your account and customer location."
    });
  }
  if (path === "/api/billing/checkout" && request.method === "POST") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as Worker secrets." }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
    const plan = String(body?.plan || "");
    if (!plans[plan]) return json({ error: "Choose a valid paid plan." }, 400);
    const priceId = env[plans[plan].priceEnv];
    if (!priceId) return json({ error: "Missing Worker secret " + plans[plan].priceEnv + ". Create a recurring monthly Price in Stripe and add its price ID as a Worker variable/secret." }, 503);
    const account = await env.DB.prepare("SELECT email,display_name,stripe_customer_id FROM users WHERE id=?").bind(user.id).first();
    if (!account) return json({ error: "Account not found." }, 404);
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("client_reference_id", user.id);
    params.set("success_url", origin + "/billing?checkout=success");
    params.set("cancel_url", origin + "/billing?checkout=cancelled");
    params.set("allow_promotion_codes", "true");
    params.set("billing_address_collection", "auto");
    params.set("customer_email", account.email);
    params.set("metadata[user_id]", user.id);
    params.set("metadata[plan]", plan);
    params.set("subscription_data[metadata][user_id]", user.id);
    params.set("subscription_data[metadata][plan]", plan);
    if (account.stripe_customer_id) {
      params.delete("customer_email");
      params.set("customer", account.stripe_customer_id);
    }
    try {
      const session = await stripeRequest(env, "checkout/sessions", params);
      if (!session.url) return json({ error: "Stripe did not return a checkout URL." }, 502);
      return json({ url: session.url });
    } catch (error) {
      return json({ error: String(error?.message || error).slice(0, 240) }, 502);
    }
  }
  if (path === "/api/billing/portal" && request.method === "POST") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe is not configured yet." }, 503);
    const account = await env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id=?").bind(user.id).first();
    if (!account?.stripe_customer_id) return json({ error: "No Stripe customer is linked to this account yet. Subscribe to a paid plan first." }, 409);
    const params = new URLSearchParams();
    params.set("customer", account.stripe_customer_id);
    params.set("return_url", new URL("/billing", request.url).toString());
    try {
      const portal = await stripeRequest(env, "billing_portal/sessions", params);
      return json({ url: portal.url });
    } catch (error) {
      return json({ error: String(error?.message || error).slice(0, 240) }, 502);
    }
  }
  return json({ error: "Not found." }, 404);
}

export async function handleStripeWebhook(request, env) {
  if (!env.DB || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return json({ error: "Stripe webhook is not configured." }, 503);
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return json({ error: "Payload too large." }, 413);
  const valid = await verifyStripeSignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET).catch(() => false);
  if (!valid) return json({ error: "Invalid Stripe webhook signature." }, 400);
  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (!event?.id || !event?.type) return json({ error: "Invalid Stripe event." }, 400);
  const existing = await env.DB.prepare("SELECT event_id FROM stripe_webhook_events WHERE event_id=?").bind(event.id).first().catch(() => null);
  if (existing) return json({ received: true, duplicate: true });
  try {
    const object = event.data?.object || {};
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await processSubscription(env.DB, object);
    } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (object.mode === "subscription" && object.subscription && (object.payment_status === "paid" || object.payment_status === "no_payment_required")) {
        const subId = typeof object.subscription === "string" ? object.subscription : object.subscription.id;
        const subscription = await stripeRequest(env, "subscriptions/" + encodeURIComponent(subId), null, "GET");
        await processSubscription(env.DB, subscription);
      }
    } else if (event.type === "invoice.payment_failed") {
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
      if (subscriptionId) {
        const row = await env.DB.prepare("SELECT id FROM users WHERE stripe_subscription_id=?").bind(subscriptionId).first();
        if (row) await env.DB.prepare("UPDATE users SET stripe_subscription_status='past_due', plan='free', plan_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(row.id).run();
      }
    }
    await env.DB.prepare("INSERT INTO stripe_webhook_events (event_id,event_type) VALUES (?,?)").bind(event.id, event.type).run();
    return json({ received: true });
  } catch (error) {
    return json({ error: "Webhook processing failed: " + String(error?.message || error).slice(0, 160) }, 500);
  }
}
