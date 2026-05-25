'use strict';

/**
 * GET /api/config
 *
 * Returns public client-side configuration values.
 * The Stripe publishable key is safe to expose — it is not a secret.
 *
 * Required env var: STRIPE_PUBLISHABLE_KEY
 */
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    stripePk: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
};
