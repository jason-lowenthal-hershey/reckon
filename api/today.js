'use strict';

const { list } = require('@vercel/blob');
const { utcDateString } = require('../lib/utils');

/**
 * GET /api/today
 *
 * Returns today's puzzle from Vercel Blob.
 * Blob path: puzzles/YYYY-MM-DD.json
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
  const prefix = `puzzles/${today}`;

  let puzzle;
  try {
    const { blobs } = await list({ prefix, limit: 1 });
    if (!blobs.length) {
      return res.status(503).json({
        error: "Today's puzzle is being prepared. Please refresh in a moment.",
        date: today,
      });
    }
    const blobRes = await fetch(blobs[0].url);
    puzzle = await blobRes.json();
  } catch (err) {
    console.error(`[today] Blob read error for ${prefix}:`, err.message);
    return res.status(503).json({
      error: "Today's puzzle is being prepared. Please refresh in a moment.",
      date: today,
    });
  }

  return res.status(200).json(puzzle);
};

