# Activating Stripe Checkout

The checkout is fully wired but **inert until you provide keys** — nothing secret lives in the code. The Subscribe button shows a setup notice until then, and goes live the moment the env vars are set. Start in **test mode**.

## 1. Create the product + price (Stripe Dashboard, test mode)
1. Toggle **Test mode** (top-right of the Stripe dashboard).
2. **Products → Add product** → name it e.g. *Zero Point Data — Pro*.
3. Add a **recurring price** (e.g. $199 / quarter or whatever you choose). Save.
4. Copy the **Price ID** — it looks like `price_1AbC...`.

## 2. Get your test secret key
- **Developers → API keys** → copy the **Secret key** (`sk_test_...`).

## 3. Run the server with the keys in env
```bash
export STRIPE_SECRET_KEY=sk_test_xxx
export STRIPE_PRICE_ID=price_xxx
export PUBLIC_BASE_URL=http://localhost:4317   # success/cancel redirect base
node server.js
```

## 4. Test the flow
- Click **Subscribe now** → you're redirected to Stripe's hosted Checkout.
- Use a Stripe **test card**: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
- On success you land on `/success.html`. No real money moves in test mode.

## 5. Going live (later)
- Swap to **live** keys (`sk_live_...`) and a **live** Price ID.
- Add a webhook (`Developers → Webhooks`) for `checkout.session.completed` to provision access / issue the API key. (The provisioning handler is a Phase-1 TODO — see `ROADMAP.md`.)
- Never commit keys. Use a secrets manager / your host's env config in production.

## Notes
- Implementation: [`src/stripe.js`](src/stripe.js) (zero-dependency, calls the Stripe REST API directly) + the `/api/checkout` and `/api/config` routes in [`server.js`](server.js).
- `/api/config` reports `stripeReady` so the frontend knows whether to enable the button.
