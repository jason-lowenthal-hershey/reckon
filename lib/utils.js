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

module.exports = { utcDateString };
