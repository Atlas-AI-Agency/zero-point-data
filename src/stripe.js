// Zero Point Data — Stripe Checkout (scaffold).
// Reads keys from env ONLY — nothing secret is ever committed.
//   STRIPE_SECRET_KEY   sk_test_...   (test mode for now)
//   STRIPE_PRICE_ID     price_...     (a recurring Price created in your Stripe dashboard)
//   PUBLIC_BASE_URL     http://localhost:4317 (used for success/cancel redirects)
//
// Zero external dependencies: we call the Stripe REST API directly over https,
// so `node server.js` runs with no `npm install`. Swap to the official `stripe`
// SDK later if you prefer.

const https = require('https');
const querystring = require('querystring');

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

// POST application/x-www-form-urlencoded to the Stripe API.
function stripeRequest(path, formObject) {
  const body = encodeForm(formObject);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'api.stripe.com',
        path,
        auth: process.env.STRIPE_SECRET_KEY + ':', // basic auth, key as username
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => {
          let json;
          try { json = JSON.parse(data); } catch (e) { return reject(new Error('bad Stripe response')); }
          if (res.statusCode >= 400) {
            return reject(new Error(json.error ? json.error.message : 'Stripe error ' + res.statusCode));
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Stripe expects nested params as foo[bar]=baz; flatten one level for our needs.
function encodeForm(obj) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object') {
          for (const [ik, iv] of Object.entries(item)) flat[`${k}[${i}][${ik}]`] = iv;
        } else {
          flat[`${k}[${i}]`] = item;
        }
      });
    } else {
      flat[k] = v;
    }
  }
  return querystring.stringify(flat);
}

// Create a subscription Checkout Session and return its hosted URL.
async function createCheckoutSession({ email } = {}) {
  if (!stripeConfigured()) {
    const e = new Error('Stripe not configured');
    e.code = 'STRIPE_UNCONFIGURED';
    throw e;
  }
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4317';
  const params = {
    mode: 'subscription',
    'line_items': [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: base + '/success.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: base + '/?checkout=cancelled',
    allow_promotion_codes: 'true',
  };
  if (email) params.customer_email = email;

  const session = await stripeRequest('/v1/checkout/sessions', params);
  return { id: session.id, url: session.url };
}

module.exports = { stripeConfigured, createCheckoutSession };
