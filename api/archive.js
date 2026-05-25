'use strict';

const { list } = require('@vercel/blob');

/**
 * GET /api/archive?key=RCKN-XXXX-XXXX-XXXX&date=YYYY-MM-DD
 *
 * Without `date`: returns a list of all available daily puzzle dates.
 * With `date`:    returns the puzzle for that specific date.
 *
 * Requires a valid archive pack key (packId = 'archive').
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const url  = new URL(req.url, `https://${req.headers.host}`);
  const key  = url.searchParams.get('key');
  const date = url.searchParams.get('date');

  if (!key) return res.status(401).json({ error: 'A license key is required' });

  if (!/^RCKN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
    return res.status(401).json({ error: 'Invalid key format' });
  }

  // Validate key
  const normalizedKey = key.toUpperCase();
  try {
    const { blobs } = await list({ prefix: `licenses/${normalizedKey}`, limit: 1 });
    if (!blobs.length) return res.status(401).json({ error: 'Key not found' });
    const resp    = await fetch(blobs[0].url);
    const license = await resp.json();
    if (license.packId !== 'archive') {
      return res.status(401).json({ error: 'Key is not valid for the archive pack' });
    }
  } catch (err) {
    console.error('[archive] Key validation error:', err.message);
    return res.status(500).json({ error: 'Storage error during key validation' });
  }

  if (date) {
    // Serve a specific puzzle by date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    try {
      const { blobs } = await list({ prefix: `puzzles/${date}`, limit: 1 });
      if (!blobs.length) return res.status(404).json({ error: `No puzzle found for ${date}` });
      const resp   = await fetch(blobs[0].url);
      const puzzle = await resp.json();
      return res.status(200).json(puzzle);
    } catch (err) {
      console.error('[archive] Puzzle fetch error:', err.message);
      return res.status(500).json({ error: 'Storage error' });
    }
  }

  // List all available dates
  try {
    const allBlobs = [];
    let cursor;
    do {
      const { blobs, cursor: next } = await list({ prefix: 'puzzles/', limit: 1000, cursor });
      allBlobs.push(...blobs);
      cursor = next;
    } while (cursor);

    const dates = allBlobs
      .map(b => b.pathname.replace('puzzles/', '').replace('.json', ''))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();  // most recent first

    return res.status(200).json({ dates });
  } catch (err) {
    console.error('[archive] List error:', err.message);
    return res.status(500).json({ error: 'Storage error' });
  }
};
