'use strict';

/**
 * Bootstrap script — generate today's puzzle by calling /api/generate.
 *
 * Usage:
 *   CRON_SECRET=<secret> API_URL=https://your-deployment.vercel.app node scripts/bootstrap.js
 *
 * Env vars:
 *   CRON_SECRET  (required) — must match the secret configured on the server
 *   API_URL      (optional) — defaults to http://localhost:3000
 *
 * Logs only the result message. Never logs puzzle contents.
 */

async function main() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('Error: CRON_SECRET environment variable is required.');
    process.exit(1);
  }

  const apiUrl = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
  const endpoint = `${apiUrl}/api/generate`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    });
  } catch (err) {
    console.error(`Error: could not reach ${endpoint} — ${err.message}`);
    process.exit(1);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error(`Error: unexpected non-JSON response (HTTP ${response.status})`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`Error (HTTP ${response.status}): ${body.error || JSON.stringify(body)}`);
    process.exit(1);
  }

  console.log(`[bootstrap] ${body.message} — date: ${body.date}, puzzle #${body.puzzleNumber}`);
}

main();
