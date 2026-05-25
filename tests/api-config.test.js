'use strict';

const handler = require('../api/config');

// ---------------------------------------------------------------------------
// Minimal req/res stubs
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

describe('GET /api/config', () => {
  const savedPk = process.env.STRIPE_PUBLISHABLE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
  });

  afterAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = savedPk;
  });

  test('returns 200 with stripePk when env var is set', () => {
    const res = makeRes();
    handler(makeReq('GET'), res);
    expect(res._status).toBe(200);
    expect(res._body.stripePk).toBe('pk_test_fake');
  });

  test('returns 200 with stripePk: null when env var is not set', () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const res = makeRes();
    handler(makeReq('GET'), res);
    expect(res._status).toBe(200);
    expect(res._body.stripePk).toBeNull();
  });

  test('sets CORS Access-Control-Allow-Origin: * on every response', () => {
    const res = makeRes();
    handler(makeReq('GET'), res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 405 for POST', () => {
    const res = makeRes();
    handler(makeReq('POST'), res);
    expect(res._status).toBe(405);
    expect(res._body.error).toMatch(/method not allowed/i);
  });

  test('returns 204 for OPTIONS', () => {
    const res = makeRes();
    handler(makeReq('OPTIONS'), res);
    expect(res._status).toBe(204);
  });

  test('returns 405 for DELETE', () => {
    const res = makeRes();
    handler(makeReq('DELETE'), res);
    expect(res._status).toBe(405);
  });
});
