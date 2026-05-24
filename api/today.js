'use strict';

const { kv } = require('@vercel/kv');

/**
 * GET /api/today
 *
 * Returns today's puzzle from Vercel KV.
 * KV key: puzzle:YYYY-MM-DD (UTC date)
 *
 * Responds:
 *   200 - puzzle document (including solution)
 *   503 - puzzle not yet available
 */
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const today = utcDateString();
  const key = `puzzle:${today}`;

  let puzzle;
  try {
    puzzle = await kv.get(key);
  } catch (err) {
    console.error(`[today] KV read error for ${key}:`, err.message);
    return res.status(503).json({
      error: "Today's puzzle is being prepared. Please refresh in a moment.",
      date: today,
    });
  }

  if (!puzzle) {
    return res.status(503).json({
      error: "Today's puzzle is being prepared. Please refresh in a moment.",
      date: today,
    });
  }

  return res.status(200).json(puzzle);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return today's UTC date as a YYYY-MM-DD string.
 */
function utcDateString(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
