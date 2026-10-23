export function publicConfig(env = process.env) {
  const key = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY : '';
  return { stripeTestMode: key.startsWith('sk_test_') };
}
