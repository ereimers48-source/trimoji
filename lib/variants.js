import { HttpError } from './http.js';

export const HAT_UNAVAILABLE =
  'Dad hats are unavailable. The Printful Classic Dad Hat (Yupoong 6245CM) is embroidery-only and needs a stitch file, which this shop does not generate.';

const sizeRow = (s, m, l, xl, xxl) => ({ S: s, M: m, L: l, XL: xl, '2XL': xxl });

// Variant IDs from the Printful catalog API on 2026-10-22:
// GET /products/71, /products/146, /products/19, /products/206
export const CATALOG = {
  tee: {
    productId: 71,
    name: 'T-shirt',
    printType: 'front',
    unitAmount: 2900,
    printfulColor: { Heather: 'Athletic Heather' },
    colors: {
      White: sizeRow(4011, 4012, 4013, 4014, 4015),
      Black: sizeRow(4016, 4017, 4018, 4019, 4020),
      Heather: sizeRow(6948, 6949, 6950, 6951, 6952),
      Navy: sizeRow(4111, 4112, 4113, 4114, 4115),
      Lilac: sizeRow(10368, 10369, 10370, 10371, 10372),
      Pink: sizeRow(4136, 4137, 4138, 4139, 4140),
      Sage: sizeRow(22050, 22051, 22052, 22053, 22054),
    },
  },
  hoodie: {
    productId: 146,
    name: 'Hoodie',
    printType: 'front',
    unitAmount: 5400,
    printfulColor: { Heather: 'Sport Grey', Pink: 'Light Pink' },
    colors: {
      White: sizeRow(5522, 5523, 5524, 5525, 5526),
      Black: sizeRow(5530, 5531, 5532, 5533, 5534),
      Heather: sizeRow(5610, 5611, 5612, 5613, 5614),
      Navy: sizeRow(5594, 5595, 5596, 5597, 5598),
      Pink: sizeRow(10849, 10850, 10851, 10852, 10853),
    },
  },
  mug: {
    productId: 19,
    name: 'Mug',
    printType: 'default',
    unitAmount: 1900,
    printfulColor: {},
    colors: {
      White: { '11 oz': 1320 },
    },
  },
};

export function resolveVariant(product, color, size) {
  if (product === 'hat') throw new HttpError(400, HAT_UNAVAILABLE);
  const catalog = CATALOG[product];
  if (!catalog) throw new HttpError(400, 'Choose a t-shirt, hoodie, or mug');
  const bySize = catalog.colors[color];
  if (!bySize) throw new HttpError(400, `${color} is not available on that product`);
  const variantId = bySize[size];
  if (!variantId) throw new HttpError(400, `${size} is not available in ${color}`);
  return {
    variantId,
    printType: catalog.printType,
    name: catalog.name,
    unitAmount: catalog.unitAmount,
    printfulColor: catalog.printfulColor[color] || color,
    catalogProductId: catalog.productId,
  };
}
