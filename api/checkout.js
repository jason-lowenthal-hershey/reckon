'use strict';

const { parseJsonBody } = require('../lib/utils');

/**
 * POST /api/checkout
 * Body: { packId: 'hard' | 'expert' | 'archive' }
 *
 * Creates a Stripe Checkout Session for a $1 pack purchase.
 * Returns { url } — the app redirects the browser to that URL.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_HARD    (Stripe Price ID for Hard Pack)
 *   STRIPE_PRICE_EXPERT  (Stripe Price ID for Expert Pack)
 *   STRIPE_PRICE_ARCHIVE (Stripe Price ID for Daily Archive)
 */

const PAID_PACKS = {
  hard:    { name: 'Hard Pack',      priceEnv: 'STRIPE_PRICE_HARD' },
  expert:  { name: 'Expert Pack',    priceEnv: 'STRIPE_PRICE_EXPERT' },
  archive: { name: 'Daily Archive',  priceEnv: 'STRIPE_PRICE_ARCHIVE' },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[checkout] STRIPE_SECRET_KEY is not set');
    return res.status(503).json({ error: 'Payment not configured' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { packId } = body || {};

  if (!packId || !PAID_PACKS[packId]) {
    return res.status(400).json({ error: `packId must be one of: ${Object.keys(PAID_PACKS).join(', ')}` });
  }

  const packMeta = PAID_PACKS[packId];
  const priceId  = process.env[packMeta.priceEnv];
  if (!priceId) {
    console.error(`[checkout] ${packMeta.priceEnv} is not set`);
    return res.status(503).json({ error: 'Payment not configured for this pack' });
  }

  const stripe       = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const host         = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const protocol     = host.includes('localhost') ? 'http' : 'https';
  const origin       = `${protocol}://${host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode:           'payment',
      line_items:     [{ price: priceId, quantity: 1 }],
      success_url:    `${origin}/?pack_session={CHECKOUT_SESSION_ID}`,
      cancel_url:     `${origin}/`,
      metadata:       { packId },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
