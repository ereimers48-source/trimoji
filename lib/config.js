// Unset STICKER_SHEET_ENABLED means the kiss-cut sticker sheet is for sale.
// Set false, 0, no, or off to hide it and refuse it at checkout.
export function stickerSheetEnabled(env = process.env) {
  const raw = env && typeof env.STICKER_SHEET_ENABLED === 'string' ? env.STICKER_SHEET_ENABLED.trim().toLowerCase() : '';
  return raw !== 'false' && raw !== '0' && raw !== 'no' && raw !== 'off';
}

export function publicConfig(env = process.env) {
  const key = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY : '';
  return {
    stripeTestMode: key.startsWith('sk_test_'),
    stickerSheet: stickerSheetEnabled(env),
  };
}
