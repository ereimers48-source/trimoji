# trimoji

Public site: https://trimojiapparel.com

The public homepage is a coming-soon page until you set `COMING_SOON=false` and redeploy. The shop stays available to the team at https://trimojiapparel.com/shop-preview (unlisted, `noindex`). Checkout, the print file, and the Stripe webhook stay on so that preview can place a test order and the existing webhook keeps working. They are not linked from the public page. GitHub Pages has no env flag, so it still serves the shop file.

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
| `COMING_SOON` | Unset, or any value other than `false`, `0`, `no`, or `off`. The homepage is the coming-soon page and the shop is only at `/shop-preview`. Set `false` and redeploy to open the shop at `/`. |
| `WAITLIST_WEBHOOK_URL` | Optional. When unset, Notify me opens an email to `hello@trimojiapparel.com` because the site has no address database. When set, `POST /api/waitlist` forwards `{ "email" }` to that URL and the page says the person is on the list. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read-write token. Story records, story photos, and account records are stored as private blobs. Submitting a story or signing in fails until this is set. |
| `STORIES_ADMIN_TOKEN` | A long random secret. `/stories-admin` is `noindex` and lists pending stories only when this token is sent as the `x-stories-token` header, `Authorization: Bearer`, or the `token` query. |
| `STORIES_PUBLIC` | Leave unset. `/stories` stays `noindex`, and the coming-soon footer does not link to it. Set `true` (or `1`, `yes`, `on`) and redeploy when the page should be indexed and linked from the coming-soon page. |
| `SESSION_SECRET` | A random secret of at least 32 characters. It signs the account session cookie. Sign-in fails closed until this is set. |
| `RESEND_API_KEY` | Resend API key. When set, sign-in emails are sent with `POST https://api.resend.com/emails` from the verified domain `trimojiapparel.com`. Already set in Vercel production. SMTP is used only when this is unset. |
| `SMTP_HOST` | SMTP hostname for sign-in emails. Used when `RESEND_API_KEY` is unset. |
| `SMTP_PORT` | SMTP port. `465` uses implicit TLS. |
| `SMTP_USER` | SMTP username. |
| `SMTP_PASS` | SMTP password. |
| `SMTP_FROM` | From address. Use `hello@trimojiapparel.com`. |
| `ACCOUNTS_PUBLIC` | Leave unset. `/account` stays `noindex`, and the coming-soon page does not link to it. Set `true` (or `1`, `yes`, `on`) and redeploy when Account should be indexed and linked from the coming-soon page. The shop header and footer link to Account either way. |

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

`GET /api/order?session_id=cs_…` reads that Checkout Session with the secret key and returns only an order reference, the item names, finishes, sizes, quantities, emoji, and the subtotal, shipping, and total. The reference is the same 32-character id sent to Printful as `external_id` (the first 32 hex characters of a SHA-256 of the Stripe session id). It does not return the email, shipping address, or payment details. The success page shows that receipt when the link includes `session_id`. The full Stripe session id is stored on the Printful order as the packing-slip message, because that create-order call has no separate notes field.

| Product | Price | Printful catalog | Print file |
| --- | --- | --- | --- |
| T-shirt | $29 | Bella+Canvas 3001, product `71` | `front` |
| Hoodie | $54 | Gildan 18500, product `146` | `front` |
| Mug | $19 | White Glossy Mug, product `19`, 11 oz only | `default` |
| Trucker hat | $33 | Yupoong 6006, product `100`, technique `dtfilm` | `front_dtf_hat`, 1650×750 at 300 DPI |

US shipping is $5.99, and free when the merchandise subtotal is $60 or more. That flat amount is what Stripe charges the customer. Printful bills the store its own fulfillment shipping when an order is confirmed. The same facts are on `/shipping`. `/privacy`, `/terms`, `/returns`, `/contact`, and `/stories` are linked from the shop footer. The coming-soon footer adds Stories only when `STORIES_PUBLIC` is on. Contact mail is hello@trimojiapparel.com.

`/stories` collects customer notes (three emojis, first name, optional city, a 20–600 character story, optional photo, optional email, and consent). Every note is stored as pending. `GET /api/stories` returns approved stories only and never includes the email. Photos are private blobs; a pending photo is not served on the public photo URL. Approve, reject, or delete from `/stories-admin`. Spam controls are a hidden honeypot field and a limit of 5 submissions per IP per hour.

`/account` is a passwordless sign-in. `POST /api/auth/request` emails a single-use link that expires in 15 minutes. The link sets an HttpOnly session cookie for 30 days. A signed-in checkout sends that email as Stripe `customer_email`. Account records live in the same private Vercel Blob store as stories, keyed by a hash of the email: profile, saved designs, and order references (city and state only). The shop header and footer link to Account. The coming-soon page does not, unless `ACCOUNTS_PUBLIC` is on. A paid Checkout session appends an order to that email when the Printful draft is created. Saved designs can be opened again in the builder. `POST /api/account/delete` removes the stored records and clears the cookie. Sign-in requests are limited to 5 per hour per IP and per email. Mail goes out through Resend when `RESEND_API_KEY` is set, and through SMTP otherwise. If neither is configured, the request fails with the same generic message and does not log the address or the link. A send failure logs only the provider status and error name on the server.

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

Tough phone case (Printful Tough Case for iPhone, product 601), $29. The blank is White. Glossy and Matte are the finish stored as the color, and the iPhone model is the size. The print file is one 1392×2220 PNG at 300 DPI for every model (`printType` `default`). The logo stays out of the top 28% of that file so it clears the camera area, and it stays off the bottom 16%. Short layouts sit near the middle of the case. Those insets are a guess until a Printful mockup is checked, and the shop preview is a drawn case rather than a generated mockup. The bag, the Stripe line, and the Printful line use the name Tough phone case.

| Model | Glossy | Matte |
| --- | --- | --- |
| iPhone 15 | 17714 | 17715 |
| iPhone 15 Plus | 17716 | 17717 |
| iPhone 15 Pro | 17718 | 17719 |
| iPhone 15 Pro Max | 17720 | 17721 |
| iPhone 16 | 20302 | 20306 |
| iPhone 16 Plus | 20303 | 20307 |
| iPhone 16 Pro | 20304 | 20308 |
| iPhone 16 Pro Max | 20305 | 20309 |
| iPhone 17 | 33985 | 33989 |
| iPhone 17 Air | 33986 | 33990 |
| iPhone 17 Pro | 33987 | 33991 |
| iPhone 17 Pro Max | 33988 | 33992 |
| iPhone 18 Pro | 52384 | 52385 |
| iPhone 18 Pro Max | 52386 | 52387 |

On `checkout.session.completed`, `POST /api/stripe-webhook` checks `STRIPE_WEBHOOK_SECRET`, then `POST https://api.printful.com/orders?confirm=false` (or `confirm=true` when `PRINTFUL_AUTO_CONFIRM=true`) with `X-PF-Store-Id`. The print file is `GET /api/print-file?design=…`, a transparent PNG of the three Twemoji SVGs (CC-BY): 1800×1800 for tees, hoodies, and mugs, 1650×750 at 300 DPI for the trucker hat, and 1392×2220 at 300 DPI for the phone case. Tokens without a product still render the square file. Printful fetches that URL, so `SITE_URL` must be the public deployment (`https://trimojiapparel.com`).

## Local check

```bash
npm install
npm test
```

The API checks mock Stripe and Printful. They do not call either service. `npm test` then runs Playwright against the system Chrome install, once at desktop size and once in an iPhone-sized touch viewport. That pass uses a local stub of Stripe, so it does not create a Checkout Session.

Emoji graphics are [Twemoji](https://github.com/jdecked/twemoji) by Twitter, Inc. and other contributors, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
