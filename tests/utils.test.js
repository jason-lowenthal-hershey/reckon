'use strict';

const { utcDateString, parseJsonBody } = require('../lib/utils');

describe('utcDateString', () => {
  test('returns a string matching YYYY-MM-DD format when called with no argument', () => {
    const result = utcDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns the correct UTC date string for a specific Date', () => {
    const date = new Date('2026-05-24T15:30:00Z');
    expect(utcDateString(date)).toBe('2026-05-24');
  });

  test('zero-pads month and day correctly (January 5)', () => {
    const date = new Date('2026-01-05T00:00:00Z');
    expect(utcDateString(date)).toBe('2026-01-05');
  });

  test('zero-pads single-digit month (March)', () => {
    const date = new Date('2026-03-09T00:00:00Z');
    expect(utcDateString(date)).toBe('2026-03-09');
  });

  test('returns correct date for a time near midnight UTC (end of previous day local time)', () => {
    // 2026-12-31T23:59:59Z is still Dec 31 UTC
    const date = new Date('2026-12-31T23:59:59Z');
    expect(utcDateString(date)).toBe('2026-12-31');
  });

  test('returns correct date for January 1 (new year rollover)', () => {
    const date = new Date('2027-01-01T00:00:00Z');
    expect(utcDateString(date)).toBe('2027-01-01');
  });
});

describe('parseJsonBody', () => {
  test('reads JSON from async stream when req.body is undefined', async () => {
    const payload = { packId: 'hard' };
    const req = {
      body: undefined,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(payload));
      },
    };
    const result = await parseJsonBody(req);
    expect(result).toEqual(payload);
  });

  test('uses req.body directly when it is already an object (vercel dev pre-parse)', async () => {
    const payload = { key: 'RCKN-ABCD-1234-EFGH', packId: 'expert' };
    const req = { body: payload };
    const result = await parseJsonBody(req);
    expect(result).toEqual(payload);
  });

  test('parses req.body when it is a JSON string', async () => {
    const payload = { packId: 'archive' };
    const req = { body: JSON.stringify(payload) };
    const result = await parseJsonBody(req);
    expect(result).toEqual(payload);
  });

  test('throws on invalid JSON in stream', async () => {
    const req = {
      body: undefined,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('not-json');
      },
    };
    await expect(parseJsonBody(req)).rejects.toThrow();
  });
});
