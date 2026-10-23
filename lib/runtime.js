import Stripe from 'stripe';

export const runtime = {
  fetch: (...args) => globalThis.fetch(...args),
  createStripe(secretKey) {
    return new Stripe(secretKey);
  },
};
