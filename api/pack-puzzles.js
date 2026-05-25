'use strict';

const { list }     = require('@vercel/blob');
const { findPack } = require('../lib/packs');

/**
 * GET /api/pack-puzzles?packId=hard&index=0&key=RCKN-XXXX-XXXX-XXXX
 *
 * Returns a single puzzle from a pre-generated pack.
 * Free packs require no key. Purchase/streak packs require a valid key
 * stored in Blob (already redeemed is fine — key stays valid after first use).
 *
 * Response 200: puzzle object { start, target, pool, solution, packId, index }
 * Response 400: missing params
 * Response 401: key required / key invalid
 * Response 404: pack not found / puzzle index out of range
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const url     = new URL(req.url, `https://${req.headers.host}`);
  const packId  = url.searchParams.get('packId');
  const indexStr = url.searchParams.get('index');
  const key     = url.searchParams.get('key');

  if (!packId)  return res.status(400).json({ error: 'packId is required' });
  if (indexStr === null) return res.status(400).json({ error: 'index is required' });

  const pack = findPack(packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  if (pack.generator === null) {
    return res.status(400).json({ error: 'Use /api/archive for historical puzzles' });
  }

  const index = parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: 'index must be a non-negative integer' });
  }
  if (pack.puzzleCount !== null && index >= pack.puzzleCount) {
    return res.status(404).json({ error: `Index out of range (pack has ${pack.puzzleCount} puzzles)` });
  }

  // Free packs: no key check
  const isFree = pack.unlock.type === 'free';
  if (!isFree) {
    if (!key) return res.status(401).json({ error: 'A license key is required for this pack' });

    if (!/^RCKN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
      return res.status(401).json({ error: 'Invalid key format' });
    }

    const normalizedKey = key.toUpperCase();
    try {
      const { blobs } = await list({ prefix: `licenses/${normalizedKey}`, limit: 1 });
      if (!blobs.length) return res.status(401).json({ error: 'Key not found' });
      const resp    = await fetch(blobs[0].url);
      const license = await resp.json();
      if (license.packId !== packId) {
        return res.status(401).json({ error: 'Key is not valid for this pack' });
      }
    } catch (err) {
      console.error('[pack-puzzles] Key validation error:', err.message);
      return res.status(500).json({ error: 'Storage error during key validation' });
    }
  }

  // Fetch the pre-generated puzzle list for this pack
  let puzzle;
  try {
    const { blobs } = await list({ prefix: `packs/${packId}/puzzles`, limit: 1 });
    if (!blobs.length) {
      return res.status(503).json({ error: 'Pack puzzles not yet generated. Try again later.' });
    }
    const resp    = await fetch(blobs[0].url);
    const puzzles = await resp.json();
    if (!Array.isArray(puzzles) || index >= puzzles.length) {
      return res.status(404).json({ error: 'Puzzle not found at this index' });
    }
    puzzle = puzzles[index];
  } catch (err) {
    console.error('[pack-puzzles] Blob read error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }

  return res.status(200).json({ ...puzzle, packId, index });
};
