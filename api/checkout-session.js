'use strict';

const { list } = require('@vercel/blob');

/**
 * GET /api/checkout-session?id=CHECKOUT_SESSION_ID
 *
 * After a successful Stripe payment, the browser is redirected to:
 *   /?pack_session=CHECKOUT_SESSION_ID
 *
 * The frontend calls this endpoint to retrieve the license key
 * so it can display it to the user and offer to save it.
 *
 * Returns { key, packId } or 404 if not yet processed.
 * The frontend should poll with a short delay (webhook may not have fired yet).
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const url       = new URL(req.url, `https://${req.headers.host}`);
  const sessionId = url.searchParams.get('id');

  if (!sessionId) return res.status(400).json({ error: 'id is required' });

  try {
    const { blobs } = await list({ prefix: `sessions/${sessionId}`, limit: 1 });
    if (!blobs.length) {
      // Webhook may not have fired yet
      return res.status(404).json({ error: 'Not yet available — try again in a moment' });
    }
    const resp = await fetch(blobs[0].url);
    const data = await resp.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[checkout-session] Error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }
};
