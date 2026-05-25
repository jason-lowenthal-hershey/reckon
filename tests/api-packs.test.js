'use strict';

jest.mock('@vercel/blob', () => ({ list: jest.fn(), put: jest.fn() }));

const { list, put } = require('@vercel/blob');

// Helper to build a minimal req/res stub
function makeReq(method = 'GET', url = 'http://localhost/api/packs', body = null) {
  const req = {
    method,
    url,
    headers: { host: 'localhost' },
    [Symbol.asyncIterator]: async function* () { if (body) yield Buffer.from(JSON.stringify(body)); },
  };
  return req;
}

function makeRes() {
  const res = {
    _status: 200, _body: null, _headers: {},
    status(s) { this._status = s; return this; },
    json(b)   { this._body  = b; return this; },
    end()     { return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
  return res;
}

describe('GET /api/packs', () => {
  const handler = require('../api/packs');

  it('returns 200 with pack catalog', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.packs).toBeInstanceOf(Array);
    expect(res._body.packs.length).toBeGreaterThan(0);
    // Sensitive fields must not be exposed
    res._body.packs.forEach(p => {
      expect(p).not.toHaveProperty('stripePrice');
      expect(p).not.toHaveProperty('generator');
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('unlock');
    });
  });

  it('returns 405 for POST', async () => {
    const res = makeRes();
    await handler(makeReq('POST'), res);
    expect(res._status).toBe(405);
  });

  it('handles OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(res._status).toBe(204);
  });
});

describe('POST /api/redeem', () => {
  const handler = require('../api/redeem');

  beforeEach(() => { jest.resetAllMocks(); });

  const VALID_KEY = 'RCKN-ABCD-EFGH-IJKL';

  it('returns 400 for invalid key format', async () => {
    const res = makeRes();
    await handler(makeReq('POST', 'http://localhost/api/redeem', { key: 'bad-key', packId: 'hard' }), res);
    expect(res._status).toBe(400);
  });

  it('returns 400 for missing packId', async () => {
    const res = makeRes();
    await handler(makeReq('POST', 'http://localhost/api/redeem', { key: VALID_KEY }), res);
    expect(res._status).toBe(400);
  });

  it('returns 404 when key not in Blob', async () => {
    list.mockResolvedValue({ blobs: [] });
    const res = makeRes();
    await handler(makeReq('POST', 'http://localhost/api/redeem', { key: VALID_KEY, packId: 'hard' }), res);
    expect(res._status).toBe(404);
  });

  it('returns 409 when key already redeemed', async () => {
    list.mockResolvedValue({ blobs: [{ url: 'https://blob/key.json' }] });
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ key: VALID_KEY, packId: 'hard', redeemedAt: '2026-01-01T00:00:00Z' }),
    });
    const res = makeRes();
    await handler(makeReq('POST', 'http://localhost/api/redeem', { key: VALID_KEY, packId: 'hard' }), res);
    expect(res._status).toBe(409);
  });

  it('returns 200 and marks key redeemed on success', async () => {
    list.mockResolvedValue({ blobs: [{ url: 'https://blob/key.json' }] });
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ key: VALID_KEY, packId: 'hard', redeemedAt: null }),
    });
    put.mockResolvedValue({});
    const res = makeRes();
    await handler(makeReq('POST', 'http://localhost/api/redeem', { key: VALID_KEY, packId: 'hard' }), res);
    expect(res._status).toBe(200);
    expect(res._body.packId).toBe('hard');
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining(VALID_KEY),
      expect.stringContaining('"redeemedAt"'),
      expect.any(Object)
    );
  });
});
