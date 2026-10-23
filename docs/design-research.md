# Trimoji design research

Short brief for the store refresh. Patterns below are adopted. Brand assets, typefaces, color values, and marketing lines from the stores studied are not.

## What we studied

- [Baymard, Product Page UX 2026](https://baymard.com/blog/current-state-ecommerce-product-page-ux) (Edward Scott, updated 18 Mar 2026). Size choices work better as visible buttons than menus. Shoppers look for shipping cost on the product page, and for a return policy when one exists. Only 48% of desktop product pages in their benchmark rate decent or better.
- [Baymard, show shipping costs on product pages](https://baymard.com/blog/show-shipping-costs-on-product-pages). Flat rates should be stated as the lowest cost, with the condition in the label.
- [Baymard, checkout flow](https://baymard.com/blog/checkout-flow-ux-optimization). The cart should show the total, including shipping, before payment. Surprise fees are a known reason people leave.
- [Cylindo, configurator layout](https://learn.cylindo.com/articles/360001025518-best-practices-for-designing-your-configurator). Keep a large preview beside the options. The option panel should not eat the picture. Sequence decisions when the choice set is large.
- [Nike By You](https://www.nike.com/nike-by-you) and [Andrew Mork’s NBY Lab notes](https://andrewmork.com/nby-lab.html). Customization is a sequence, not a blank canvas. The useful split is preview on one side and the build steps on the other.
- [Printful Design Maker](https://www.printful.com/design-maker). Four beats: pick a product, add the design, save, order. [Custom Ink’s lab](https://www.customink.com/help_center/navigate-the-lab) keeps color, product, and price in view while you edit.
- [Awwwards e-commerce collection](https://www.awwwards.com/awwwards/collections/e-commerce/), including [Palmer Dinnerware](https://www.awwwards.com/a-digital-canvas-for-palmer-dinnerware.html) (2025) and [Ranboo Fashion](https://www.awwwards.com/sites/ranboo-fashion-merch-site). Awarded shops spend whitespace and type on the product, and they keep motion quiet enough to turn off.
- [Allbirds](https://www.allbirds.com/) and third-party readings of its system ([Mozaika](https://mozaika.design/ds/allbirds)): a warm paper field, one quiet ink, product imagery doing the color work.
- [teenage engineering](https://teenage.engineering/) as described in public system notes ([Duply](https://duply.ai/teenage/design-md)): the object is the loudest thing on the page. Chrome stays out of the way.
- [MSCHF](https://mschf.com/): one idea on screen, the product is the headline. Useful for a single custom object, not as a visual style to copy.

## Patterns we are using

1. **Type pairing and a scale.** Fraunces (soft display serif, SIL Open Font License) for headlines. Outfit (grotesque, SIL Open Font License) for UI and body. Sizes step from a small label (0.78rem) through body (1rem) to a fluid display (`clamp`) with line-height 1.45–1.5 so lines do not collide. These are not any studied brand’s fonts.
2. **One paper, one ink, three signals.** Warm paper background, near-black ink, and the existing sun / hot pink / lime used only for the trio, the highlight, selected choices, and confetti. Cards are paper with a hairline and a soft shadow, not a sticker border on every block.
3. **Room and a two-column studio.** Sections use a wide padding rhythm. From 900px the builder is preview left, steps right, with the preview sticky under the real header height. On small screens the preview comes first, then the steps.
4. **Four steps, in order.** 1 Pick, 2 Arrange, 3 Choose product, 4 Checkout. Color and size stay visible buttons. The price, the flat shipping line, and the add-to-cart control sit on step 4. The cart repeats subtotal, US shipping, and total before the Stripe button.
5. **Product drawings that read as photos.** The mockups keep the same logo placement and the same color fills the tests check. Shading, a floor shadow, collar and cuff folds, a ceramic highlight, and the trucker mesh sit on top of those fills so the garment has a light side and a dark side.
6. **Trust row, only facts we can stand behind.** US shipping is $5.99 and free at $60. Printful prints the order. Checkout is Stripe, and the card form is Stripe’s. There is no published returns promise, so the row does not invent one.
7. **Motion with a brake.** Confetti, the hero bob, and small hover lifts stay. `prefers-reduced-motion` still removes animation and transitions.

## What we are not taking

No borrowed logos, product photos, slogans, or palette hex values. No fake reviews, delivery dates, or return windows. The hero try-row, test-mode banner, and overlap checks stay.
