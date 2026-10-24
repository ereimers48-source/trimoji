# trimoji

Live shop: https://trimojiapparel.com

Checkout runs on Vercel. GitHub Pages stays a static preview: the cart still works, and Checkout tells you to use the live shop when `/api/checkout` is unreachable.

## Deploy on Vercel (Hobby)

1. In the [Vercel dashboard](https://vercel.com/new), choose **Add New… → Project** and import the GitHub repo `ereimers48-source/trimoji`.
2. Framework preset: **Other** (no framework). Root directory: the repo root. Leave the build command empty. Output is the static site plus the `/api` functions.
3. Open **Environment Variables** and add these. Use **test mode** first.

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Your Stripe **test** secret key. It starts with `sk_test_`. In the Stripe Dashboard, turn **Test mode** on, then Developers → API keys → Secret key. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of a **test-mode** webhook (`whsec_…`). Create it in step 5. You can deploy once without it, then add it and redeploy. |
| `PRINTFUL_API_TOKEN` | A Printful private API token (Settings → API). |
| `PRINTFUL_STORE_ID` | `18937301` (the Trimoji store). Sent as `X-PF-Store-Id`. |
| `SITE_URL` | `https://trimojiapparel.com`, with no trailing slash. Success, cancel, and print-file URLs are built from this. If it is unset, checkout uses that origin. Page requests on `www.trimojiapparel.com` and `https://trimoji.vercel.app` redirect to that origin. `/api` stays on the Vercel host, so an existing webhook at `https://trimoji.vercel.app/api/stripe-webhook` still reaches this deployment. |
| `PRINTFUL_AUTO_CONFIRM` | `false` (or leave unset). Orders are Printful drafts (`confirm=false`). Set to the exact string `true` only when a paid order should be submitted for fulfillment immediately. |

4. Deploy. The shop is the deployment URL. A yellow **Test mode** banner appears when `STRIPE_SECRET_KEY` starts with `sk_test_`. The key itself is never sent to the browser (`GET /api/config` returns only `{ "stripeTestMode": true }`).
5. Create the Stripe webhook in **test mode** (the Test mode toggle in the Stripe Dashboard must be on):
   - Developers → Webhooks → **Add endpoint**
   - Endpoint URL: `https://<vercel-domain>/api/stripe-webhook`
   - Event: `checkout.session.completed`
   - Open the endpoint and reveal the **Signing secret**
   - Paste that secret into `STRIPE_WEBHOOK_SECRET` and redeploy
6. Pay with a [Stripe test card](https://docs.stripe.com/testing#cards) such as `4242 4242 4242 4242`. Use a US shipping address. The webhook renders a Twemoji PNG and creates a Printful **draft** order on store `18937301`. Confirm the draft in the Printful dashboard (or set `PRINTFUL_AUTO_CONFIRM=true` when you want it submitted for you).

### Switching to live keys later

When you are ready to charge real cards:

1. Replace `STRIPE_SECRET_KEY` with the live secret key (`sk_live_…`).
2. In the Stripe Dashboard, turn **Test mode off** and add a second webhook endpoint for the same URL, `https://<vercel-domain>/api/stripe-webhook`, listening for `checkout.session.completed`.
3. Replace `STRIPE_WEBHOOK_SECRET` with that **live** endpoint’s signing secret. Test and live secrets are not interchangeable.
4. Redeploy. The Test mode banner stays hidden while the secret key does not start with `sk_test_`.

## What checkout does

`POST /api/checkout` accepts the cart (product, color, size, quantity, three emojis, layout, logo size). Prices are recomputed on the server. Client prices are ignored. The print file is transparent behind the emojis.

| Product | Price | Printful catalog | Print file |
| --- | --- | --- | --- |
| T-shirt | $29 | Bella+Canvas 3001, product `71` | `front` |
| Hoodie | $54 | Gildan 18500, product `146` | `front` |
| Mug | $19 | White Glossy Mug, product `19`, 11 oz only | `default` |
| Trucker hat | $33 | Yupoong 6006, product `100`, technique `dtfilm` | `front_dtf_hat`, 1650×750 at 300 DPI |

US shipping is $5.99, and free when the merchandise subtotal is $60 or more. That flat amount is what Stripe charges the customer. Printful bills the store its own fulfillment shipping when an order is confirmed. The same facts are on `/shipping`. `/privacy`, `/terms`, `/returns`, and `/contact` are linked from the footer. Contact mail is hello@trimojiapparel.com.

Variant IDs were read from `GET https://api.printful.com/products/{id}` on 2026-10-22.

T-shirt (Bella+Canvas 3001), sizes S / M / L / XL / 2XL:

| Color on the site | Printful color | S | M | L | XL | 2XL |
| --- | --- | --- | --- | --- | --- | --- |
| White | White | 4011 | 4012 | 4013 | 4014 | 4015 |
| Black | Black | 4016 | 4017 | 4018 | 4019 | 4020 |
| Heather | Athletic Heather | 6948 | 6949 | 6950 | 6951 | 6952 |
| Navy | Navy | 4111 | 4112 | 4113 | 4114 | 4115 |
| Lilac | Lilac | 10368 | 10369 | 10370 | 10371 | 10372 |
| Pink | Pink | 4136 | 4137 | 4138 | 4139 | 4140 |
| Sage | Sage | 22050 | 22051 | 22052 | 22053 | 22054 |

Hoodie (Gildan 18500), sizes S / M / L / XL / 2XL. Lilac and Sage are not in this catalog product, so the builder does not offer them.

| Color on the site | Printful color | S | M | L | XL | 2XL |
| --- | --- | --- | --- | --- | --- | --- |
| White | White | 5522 | 5523 | 5524 | 5525 | 5526 |
| Black | Black | 5530 | 5531 | 5532 | 5533 | 5534 |
| Heather | Sport Grey | 5610 | 5611 | 5612 | 5613 | 5614 |
| Navy | Navy | 5594 | 5595 | 5596 | 5597 | 5598 |
| Pink | Light Pink | 10849 | 10850 | 10851 | 10852 | 10853 |

Mug: White / 11 oz → variant `1320`. The 15 oz variant `4830` exists and is not sold.

Trucker hat (Yupoong 6006, five-panel mesh back), one size. Confirmed from `GET https://api.printful.com/products/100` on 2026-10-23. The blank is $15.09 and the DTF front placement (`front_dtf_hat`) adds $2.95, so the Printful product cost is $18.04 before their shipping. $28 would be about 55% above that cost and about 36% of the selling price, so the shop price is $33, which keeps about 45% of the sale (($33 − $18.04) / $33). Embroidery is the catalog default on this hat, so each order item sends `options: [{ id: "technique", value: "dtfilm" }]` with the print file. The DTF template is 5.5″ × 2.5″ at 300 DPI (1650×750, PNG pHYs). Two-tone colorways are in the catalog and are not sold. The Classic Dad Hat (product `206`) is embroidery-only and is not sold.

| Color on the site | Printful color | One size |
| --- | --- | --- |
| White | White | 4810 |
| Black | Black | 4811 |
| Charcoal | Charcoal | 4814 |
| Navy | Navy | 4816 |

On `checkout.session.completed`, `POST /api/stripe-webhook` checks `STRIPE_WEBHOOK_SECRET`, then `POST https://api.printful.com/orders?confirm=false` (or `confirm=true` when `PRINTFUL_AUTO_CONFIRM=true`) with `X-PF-Store-Id`. The print file is `GET /api/print-file?design=…`, a transparent PNG of the three Twemoji SVGs (CC-BY): 1800×1800 for tees, hoodies, and mugs, and 1650×750 at 300 DPI for the trucker hat. Tokens without a product still render the square file. Printful fetches that URL, so `SITE_URL` must be the public deployment (`https://trimojiapparel.com`).

## Local check

```bash
npm install
npm test
```

The API checks mock Stripe and Printful. They do not call either service. `npm test` then runs Playwright against the system Chrome install, once at desktop size and once in an iPhone-sized touch viewport. That pass uses a local stub of Stripe, so it does not create a Checkout Session.

Emoji graphics are [Twemoji](https://github.com/jdecked/twemoji) by Twitter, Inc. and other contributors, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
