# Promotion codes

Coupons and promotion codes live in the Stripe Dashboard. This repo does not keep a list of codes. Checkout asks Stripe to show the code field unless `PROMO_CODES_ENABLED` is `false`, `0`, `no`, or `off` (any other value, including unset, leaves it on).

Use the same Dashboard mode as the secret key. Test mode for `sk_test_…`, live mode for `sk_live_…`. A code created in one mode does not work in the other.

## Create a coupon

1. Open the [Stripe Dashboard](https://dashboard.stripe.com).
2. Go to **Product catalog → Coupons** (Products > Coupons). Direct link: [dashboard.stripe.com/coupons](https://dashboard.stripe.com/coupons).
3. Click **+ New** (or **Create coupon**).
4. Choose **Percentage off** or **Fixed amount off**. For a fixed amount, use USD. Duration for this shop is **Once** (one Checkout).
5. Set a **Name**. The receipt and the order email use the promotion code text when Stripe sends it, and this coupon name when there is no code text.

Do not put the customer-facing code in the coupon id. The id is an internal Stripe id. The text the customer types is the promotion code in the next step.

## Create a promotion code

On the create-coupon page, open **Use customer-facing promotion codes** (after the coupon exists, the same control is **Create promotion code** on the coupon). Then:

- **Code.** The text the customer types at Checkout, such as `WELCOME`. Stripe treats it as case-insensitive. Active codes must be unique. Letters, numbers, and dashes only. Leave it blank only if Stripe should invent one.
- **Limits.** Set the maximum redemptions for the code, and a per-customer limit if the form shows one. This is separate from the coupon's own redemption cap. The code's cap cannot be higher than the coupon's.
- **Expiry.** Set a date if the code should stop working. It cannot be later than the coupon's redeem-by date.
- **Eligible for first-time order only.** Turn this on to limit the code to customers with no successful payment on the Stripe account. A payment that was started and not finished still counts as not first-time.
- **Require minimum order value.** Turn this on and enter a USD minimum. Stripe checks it when the code is redeemed. The shop's $60 free-shipping rule is separate and is not this field.

Save the coupon. The code is active immediately. Checkout will accept it on the next session. No deploy is required for a new code.

To stop a code, deactivate that promotion code in the Dashboard. To turn the field off for every session, set `PROMO_CODES_ENABLED` to `false` and redeploy.

## What Checkout does with a code

Stripe Checkout collects the code. This repo never sees the list.

- **Tax.** With tax on (the default), the session still sends `automatic_tax: { enabled: true }` and `tax_behavior: exclusive` on each item and on the US shipping option (`txcd_92010001`). Stripe applies the discount first, then calculates tax on the discounted amount. The receipt shows Stripe's `amount_discount` and `amount_tax` as separate lines.
- **Shipping.** Free shipping is decided here, before Checkout, from the merchandise subtotal: $5.99 under $60, and $0 at $60 or more. A code does not move that threshold. A $70 order stays free shipping after a discount. A $50 order still includes the $5.99 option after a discount. With tax on, that amount is a shipping rate, which a normal coupon does not reduce. With tax off, shipping is an extra product line, so a percent-off coupon can reduce that line too. Either way, the threshold itself stays on the pre-discount subtotal.
- **Receipt.** The success page and the order email show one discount line, `Discount CODE -$X.XX`, using `total_details.amount_discount` and the code or coupon name from the session's expanded `discounts`. The amount paid is `amount_total` after the discount, including `$0.00`.
- **Card on a $0 order.** `payment_method_collection: if_required` is not sent. Stripe's create-session API rejects that value on `mode: 'payment'` (it is subscription-only) and would fail every Checkout. The default stays in place. On API versions that support [no-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders) (2023-08-16 or later), a $0 total can still complete without a card and `payment_status` is `no_payment_required`. If Checkout does collect a card for a $0 total, `payment_status` is `paid`. The webhook fulfills both.
- **Printful.** The draft order still uses each variant's catalog `retail_price` (for example `29.00`). The discount is not copied onto the Printful payload, so a $0 Stripe total does not zero the retail price or drop the line.

Stripe's own notes on coupons and codes: [Add discounts to Checkout](https://docs.stripe.com/payments/checkout/discounts) and [Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons).
