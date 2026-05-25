'use strict';

const { parseJsonBody } = require('../lib/utils');

/**
 * POST /api/payment-intent
 * Body: { packId: 'hard' | 'expert' | 'archive' }
 *
 * Creates a Stripe PaymentIntent for a $1 pack purchase.
 * Returns { clientSecret } — the frontend uses this to mount the Payment Element.
 *
 * Required env vars: STRIPE_SECRET_KEY
 */

const PAID_PACK_IDS = new Set(['hard', 'expert', 'archive']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[payment-intent] STRIPE_SECRET_KEY is not set');
    return res.status(503).json({ error: 'Payment not configured' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { packId } = body || {};

  if (!packId || !PAID_PACK_IDS.has(packId)) {
    return res.status(400).json({ error: `packId must be one of: ${[...PAID_PACK_IDS].join(', ')}` });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   100,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { packId },
    });
    return res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('[payment-intent] Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
};
