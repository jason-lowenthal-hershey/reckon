'use strict';

const { getPublicCatalog } = require('../lib/packs');

/**
 * GET /api/packs
 *
 * Returns the public pack catalog (id, name, emoji, description,
 * puzzleCount, unlock). No authentication required.
 * Stripe price IDs and generator configs are never exposed.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({ packs: getPublicCatalog() });
};
