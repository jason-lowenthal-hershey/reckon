'use strict';

const { list, put }    = require('@vercel/blob');
const { findPack }     = require('../lib/packs');
const { parseJsonBody } = require('../lib/utils');

/**
 * POST /api/redeem
 * Body: { key: 'RCKN-XXXX-XXXX-XXXX', packId: 'hard' }
 *
 * Validates the key against Blob storage and, if unused and matching
 * the requested pack, marks it as redeemed and returns the pack ID.
 *
 * Response 200: { packId, pack: { name, emoji, description } }
 * Response 400: { error: 'Invalid key format' }
 * Response 404: { error: 'Key not found' }
 * Response 409: { error: 'Key already redeemed' }
 * Response 422: { error: 'Key is for a different pack' }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await parseJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { key, packId } = body || {};

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'key is required' });
  }
  if (!packId || typeof packId !== 'string') {
    return res.status(400).json({ error: 'packId is required' });
  }

  // Validate key format: RCKN-[4]-[4]-[4] alphanumeric
  if (!/^RCKN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }

  const pack = findPack(packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const normalizedKey = key.toUpperCase();
  const pathname      = `licenses/${normalizedKey}.json`;

  // Look up the key in Blob
  let license;
  try {
    const { blobs } = await list({ prefix: `licenses/${normalizedKey}`, limit: 1 });
    if (!blobs.length) return res.status(404).json({ error: 'Key not found' });
    const resp   = await fetch(blobs[0].url);
    license = await resp.json();
  } catch (err) {
    console.error('[redeem] Blob read error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }

  if (license.redeemedAt) {
    return res.status(409).json({ error: 'Key already redeemed' });
  }
  if (license.packId !== packId) {
    return res.status(422).json({ error: 'Key is for a different pack' });
  }

  // Mark redeemed
  license.redeemedAt = new Date().toISOString();
  try {
    await put(pathname, JSON.stringify(license), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error('[redeem] Blob write error:', err.message);
    return res.status(500).json({ error: 'Storage write error' });
  }

  return res.status(200).json({
    packId,
    pack: { name: pack.name, emoji: pack.emoji, description: pack.description },
  });
};
