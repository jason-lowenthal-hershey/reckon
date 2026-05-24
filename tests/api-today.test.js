'use strict';

jest.mock('@vercel/blob', () => ({
  list: jest.fn(),
}));

const { list } = require('@vercel/blob');
const handler = require('../api/today');

// ---------------------------------------------------------------------------
// Minimal req/res stubs (no Express needed)
// ---------------------------------------------------------------------------

function makeReq(method = 'GET') {
  return { method, headers: {} };
}

function makeRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: null,
    setHeader(k, v) { this._headers[k] = v; return this; },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    end() { return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/today', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  test('sets CORS Access-Control-Allow-Origin: * on every response', async () => {
    list.mockResolvedValue({ blobs: [] });
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 204 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(res._status).toBe(204);
  });

  test('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res._status).toBe(405);
  });

  test('returns 503 with friendly message when no blob exists for today', async () => {
    list.mockResolvedValue({ blobs: [] });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/being prepared/i);
    expect(res._body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns 503 when the blob list call throws', async () => {
    list.mockRejectedValue(new Error('network error'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
  });

  test('returns 503 when fetching blob content fails', async () => {
    list.mockResolvedValue({ blobs: [{ url: 'https://blob.example.com/p.json' }] });
    global.fetch.mockRejectedValue(new Error('fetch failed'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(503);
  });

  test('returns 200 with the puzzle document when blob exists', async () => {
    const fakePuzzle = {
      _id: '2026-05-24',
      puzzleNumber: 2,
      start: 8,
      target: 72,
      pool: [],
      solution: [],
    };
    list.mockResolvedValue({ blobs: [{ url: 'https://blob.example.com/p.json' }] });
    global.fetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue(fakePuzzle),
    });

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual(fakePuzzle);
  });

  test('reads blob URL without an Authorization header (public store)', async () => {
    list.mockResolvedValue({ blobs: [{ url: 'https://blob.example.com/p.json' }] });
    global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue({}) });

    await handler(makeReq(), makeRes());

    // fetch should have been called with only the URL (or an empty/undefined headers map)
    const [calledUrl, calledOpts] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('https://blob.example.com/p.json');
    // No Authorization header expected for a public blob
    const authHeader = calledOpts?.headers?.authorization ?? calledOpts?.headers?.Authorization;
    expect(authHeader).toBeUndefined();
  });
});
