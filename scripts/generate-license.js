'use strict';

/**
 * Generate a license key for a pack and upload it to Vercel Blob.
 * Use this for coupon codes, testing, and gifting packs.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/generate-license.js <packId> [--count=N] [--note="reason"]
 *
 * Examples:
 *   node scripts/generate-license.js hard
 *   node scripts/generate-license.js expert --count=5
 *   node scripts/generate-license.js archive --note="press copy"
 */

try { require('dotenv').config({ path: '.env.local' }); } catch { /* optional dep */ }

const { put }      = require('@vercel/blob');
const { findPack } = require('../lib/packs');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

function generateKey() {
  const group = () => Array.from({ length: 4 }, () =>
    CHARSET[Math.floor(Math.random() * CHARSET.length)]
  ).join('');
  return `RCKN-${group()}-${group()}-${group()}`;
}

async function main() {
  const packId = process.argv[2];
  if (!packId) {
    console.error('Usage: node scripts/generate-license.js <packId> [--count=N] [--note="..."]');
    process.exit(1);
  }

  const pack = findPack(packId);
  if (!pack) {
    console.error(`Pack "${packId}" not found.`);
    process.exit(1);
  }

  const countArg = process.argv.find(a => a.startsWith('--count='));
  const noteArg  = process.argv.find(a => a.startsWith('--note='));
  const count    = countArg ? parseInt(countArg.split('=')[1], 10) : 1;
  const note     = noteArg  ? noteArg.split('=').slice(1).join('=') : 'coupon';

  for (let i = 0; i < count; i++) {
    const key = generateKey();
    const license = {
      key,
      packId,
      type:        'coupon',
      note,
      createdAt:   new Date().toISOString(),
      redeemedAt:  null,
      email:       null,
    };

    await put(`licenses/${key}.json`, JSON.stringify(license), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    console.log(`${key}  (${packId})`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
