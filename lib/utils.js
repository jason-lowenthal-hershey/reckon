'use strict';

/**
 * Return a UTC date as a YYYY-MM-DD string.
 * Defaults to today if no Date is passed.
 */
function utcDateString(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a JSON request body from a Vercel serverless function request.
 *
 * Handles two cases:
 *   - `vercel dev` (and some middleware stacks) may pre-parse the body onto
 *     `req.body` before the handler runs, leaving the readable stream empty.
 *   - Production Vercel functions receive a raw stream that must be buffered.
 *
 * Returns the parsed object, or throws on invalid JSON / empty body.
 */
async function parseJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

module.exports = { utcDateString, parseJsonBody };
