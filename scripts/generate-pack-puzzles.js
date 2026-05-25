'use strict';

/**
 * Generate and upload all puzzles for a pack to Vercel Blob.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/generate-pack-puzzles.js <packId>
 *
 * Example:
 *   node scripts/generate-pack-puzzles.js hard
 *   node scripts/generate-pack-puzzles.js practice
 *
 * Reads BLOB_READ_WRITE_TOKEN from env (or .env.local via dotenv if present).
 * Overwrites any existing puzzles.json for the pack.
 */

// Load .env.local if present
try { require('dotenv').config({ path: '.env.local' }); } catch { /* optional dep */ }

const { put }            = require('@vercel/blob');
const { findPack }       = require('../lib/packs');
const { generatePuzzle } = require('../lib/generator');

async function main() {
  const packId = process.argv[2];
  if (!packId) {
    console.error('Usage: node scripts/generate-pack-puzzles.js <packId>');
    process.exit(1);
  }

  const pack = findPack(packId);
  if (!pack) {
    console.error(`Pack "${packId}" not found. Available: practice, loyal, hard, expert`);
    process.exit(1);
  }
  if (!pack.generator) {
    console.error(`Pack "${packId}" uses historical puzzles — no generation needed.`);
    process.exit(1);
  }
  if (!pack.puzzleCount) {
    console.error(`Pack "${packId}" has no fixed puzzle count.`);
    process.exit(1);
  }

  console.log(`Generating ${pack.puzzleCount} puzzles for "${pack.name}"...`);

  const puzzles = [];
  for (let i = 0; i < pack.puzzleCount; i++) {
    const puzzle = generatePuzzle(i + 1, pack.generator);
    // Strip solution for storage? No — client needs solution for reveal/feedback.
    puzzles.push({ ...puzzle, packId, index: i });
    if ((i + 1) % 5 === 0) process.stdout.write(`  ${i + 1}/${pack.puzzleCount}...\n`);
  }

  const pathname = `packs/${packId}/puzzles.json`;
  await put(pathname, JSON.stringify(puzzles), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  console.log(`Done. Uploaded ${puzzles.length} puzzles to ${pathname}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
