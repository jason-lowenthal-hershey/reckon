'use strict';

const { put, list } = require('@vercel/blob');
const { generatePuzzle } = require('../lib/generator');
const { utcDateString } = require('../lib/utils');

const LAUNCH_DATE = '2026-05-23'; // Launch day is puzzle #1

/**
 * GET /api/generate  (called by Vercel Cron)
 *
 * Authorization: Bearer <CRON_SECRET>
 *
 * Generates today's puzzle and stores it in Blob if it doesn't already exist.
 * Idempotent: safe to call multiple times for the same day.
 *
 * IMPORTANT: never log puzzle contents (start, target, pool, solution).
 */
module.exports = async function handler(req, res) {
  // --- Auth ---
  const authHeader = req.headers['authorization'] || '';
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const today = utcDateString();
  const pathname = `puzzles/${today}.json`;

  // --- Idempotency check ---
  try {
    const { blobs } = await list({ prefix: `puzzles/${today}`, limit: 1 });
    if (blobs.length > 0) {
      // Fetch just enough to get the puzzleNumber — don't log puzzle contents
      const existingRes = await fetch(blobs[0].url, {
        headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      const existing = await existingRes.json();
      console.log(`[generate] Puzzle already exists for ${today}`);
      return res.status(200).json({
        message: 'Puzzle already exists for today',
        date: today,
        puzzleNumber: existing.puzzleNumber,
      });
    }
  } catch (err) {
    console.error(`[generate] Blob read error for ${today}:`, err.message);
    return res.status(500).json({ error: 'Storage read failed', date: today });
  }

  // --- Compute puzzle number ---
  const puzzleNumber = daysSinceLaunch(today) + 1;

  // --- Generate puzzle ---
  let puzzle;
  try {
    puzzle = generatePuzzle(puzzleNumber);
  } catch (err) {
    console.error(`[generate] Generation failed for ${today}:`, err.message);
    return res.status(500).json({ error: 'Puzzle generation failed', date: today });
  }

  // --- Persist to Blob ---
  const doc = {
    _id: today,
    puzzleNumber: puzzle.puzzleNumber,
    start: puzzle.start,
    target: puzzle.target,
    pool: puzzle.pool,
    solution: puzzle.solution,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(pathname, JSON.stringify(doc), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error(`[generate] Blob write error for ${today}:`, err.message);
    return res.status(500).json({ error: 'Storage write failed', date: today });
  }

  // Log success WITHOUT logging puzzle contents
  console.log(`[generate] Successfully generated puzzle #${puzzleNumber} for ${today}`);

  return res.status(200).json({
    message: 'Puzzle generated successfully',
    date: today,
    puzzleNumber,
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the number of days elapsed since LAUNCH_DATE.
 * Launch day itself returns 0 (so puzzleNumber = 1).
 */
function daysSinceLaunch(dateStr) {
  const launch = new Date(`${LAUNCH_DATE}T00:00:00Z`);
  const current = new Date(`${dateStr}T00:00:00Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((current - launch) / msPerDay);
}
