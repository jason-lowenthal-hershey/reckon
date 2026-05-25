'use strict';

const { put, list }     = require('@vercel/blob');
const { parseJsonBody } = require('../lib/utils');

/**
 * POST /api/fulfill
 * Body: { paymentIntentId: 'pi_...' }
 *
 * Verifies the PaymentIntent succeeded with Stripe, then generates and
 * persists a RCKN license key for the purchased pack. Idempotent — calling
 * it twice for the same PI returns the same key.
 *
 * Returns { key, packId }
 *
 * Required env vars: STRIPE_SECRET_KEY
 */

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateKey() {
  const group = () => Array.from({ length: 4 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join('');
  return `RCKN-${group()}-${group()}-${group()}`;
}

const PAID_PACK_IDS = new Set(['hard', 'expert', 'archive']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[fulfill] STRIPE_SECRET_KEY is not set');
    return res.status(503).json({ error: 'Payment not configured' });
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { paymentIntentId } = body || {};

  if (!paymentIntentId || typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return res.status(400).json({ error: 'paymentIntentId is required' });
  }

  // Idempotency check: has this PI already been fulfilled?
  const sessionPath = `sessions/pi_${paymentIntentId}.json`;
  try {
    const { blobs } = await list({ prefix: `sessions/pi_${paymentIntentId}`, limit: 1 });
    if (blobs.length) {
      const existing = await fetch(blobs[0].url).then(r => r.json());
      return res.status(200).json({ key: existing.key, packId: existing.packId });
    }
  } catch {
    // Not yet fulfilled — continue
  }

  // Verify payment with Stripe
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    console.error('[fulfill] Stripe retrieve error:', err.message);
    return res.status(400).json({ error: 'Invalid payment intent' });
  }

  if (intent.status !== 'succeeded') {
    return res.status(402).json({ error: `Payment not completed (status: ${intent.status})` });
  }

  const { packId } = intent.metadata || {};
  if (!packId || !PAID_PACK_IDS.has(packId)) {
    console.error('[fulfill] Invalid packId in payment metadata:', packId, intent.id);
    return res.status(400).json({ error: 'Invalid pack in payment metadata' });
  }

  // Generate and store license key
  const key     = generateKey();
  const license = {
    key,
    packId,
    type:                'purchase',
    stripePaymentIntent: paymentIntentId,
    createdAt:           new Date().toISOString(),
    redeemedAt:          null,
  };

  try {
    await put(`licenses/${key}.json`, JSON.stringify(license), {
      access: 'public', contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: false,
    });
    // Store PI→key for idempotency
    await put(sessionPath, JSON.stringify({ key, packId }), {
      access: 'public', contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: false,
    });
    console.log(`[fulfill] Key generated for ${packId}: ${key.substring(0, 9)}***`);
  } catch (err) {
    console.error('[fulfill] Blob write error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }

  return res.status(200).json({ key, packId });
};
