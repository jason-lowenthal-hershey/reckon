'use strict';

const { put } = require('@vercel/blob');

/**
 * POST /api/webhook  (Stripe webhook endpoint)
 *
 * Handles checkout.session.completed events:
 *   1. Generates a RCKN-XXXX-XXXX-XXXX license key
 *   2. Stores it in Blob as licenses/{key}.json
 *   3. Also stores sessions/{sessionId}.json → { key } for retrieval by success URL
 *   4. Emails the key to the buyer via Resend
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL  (e.g. "Reckon <puzzles@reckon.app>")
 */

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateKey() {
  const group = () => Array.from({ length: 4 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join('');
  return `RCKN-${group()}-${group()}-${group()}`;
}

const PACK_NAMES = {
  hard:    'Hard Pack',
  expert:  'Expert Pack',
  archive: 'Daily Archive',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[webhook] Stripe env vars not set');
    return res.status(503).json({ error: 'Not configured' });
  }

  // Read raw body (required for Stripe signature verification)
  let rawBody;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks);
  } catch (err) {
    console.error('[webhook] Body read error:', err.message);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig    = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  // Only handle successful payments
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const { packId } = session.metadata || {};
  const email = session.customer_details?.email || session.customer_email || '';

  if (!packId) {
    console.error('[webhook] Missing packId in session metadata', session.id);
    return res.status(200).json({ received: true }); // 200 so Stripe doesn't retry
  }

  const key     = generateKey();
  const license = {
    key,
    packId,
    type:          'purchase',
    email,
    stripeSession: session.id,
    createdAt:     new Date().toISOString(),
    redeemedAt:    null,
  };

  try {
    // Store license key
    await put(`licenses/${key}.json`, JSON.stringify(license), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    // Store session → key mapping (for success-URL retrieval)
    await put(`sessions/${session.id}.json`, JSON.stringify({ key, packId }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    console.log(`[webhook] Key generated for ${packId}: ${key.substring(0, 9)}***`);
  } catch (err) {
    console.error('[webhook] Blob write error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }

  // Send email with license key
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend     = new Resend(process.env.RESEND_API_KEY);
      const packName   = PACK_NAMES[packId] || packId;
      const fromEmail  = process.env.RESEND_FROM_EMAIL || 'Reckon <noreply@reckon.app>';

      await resend.emails.send({
        from:    fromEmail,
        to:      email,
        subject: `Your Reckon ${packName} license key`,
        text: [
          `Thanks for purchasing the Reckon ${packName}!`,
          '',
          `Your license key:  ${key}`,
          '',
          `To unlock your pack:`,
          `1. Open Reckon at https://reckon-chi.vercel.app`,
          `2. Tap the Packs button`,
          `3. Tap the pack you purchased`,
          `4. Tap "Enter Key" and paste your key`,
          '',
          'Keep this email — you can use the key on any new device.',
          '',
          '— The Reckon team',
        ].join('\n'),
        html: `
          <p>Thanks for purchasing the Reckon <strong>${packName}</strong>!</p>
          <p style="font-family:monospace;font-size:1.4em;letter-spacing:0.1em;
                     background:#f5f5f5;padding:12px 20px;border-radius:6px;
                     display:inline-block;">${key}</p>
          <p><strong>To unlock your pack:</strong></p>
          <ol>
            <li>Open Reckon</li>
            <li>Tap the Packs button in the header</li>
            <li>Tap the pack you purchased</li>
            <li>Tap "Enter Key" and paste your key</li>
          </ol>
          <p>Keep this email — you can use the key on any new device.</p>
        `,
      });
      console.log(`[webhook] Email sent to ${email}`);
    } catch (err) {
      // Non-fatal: key is stored, email is best-effort
      console.error('[webhook] Email send error:', err.message);
    }
  }

  return res.status(200).json({ received: true });
};
