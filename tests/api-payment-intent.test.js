'use strict';

jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: {
    create: jest.fn().mockResolvedValue({ client_secret: 'pi_test_secret_xxx' }),
  },
})));

const handler = require('../api/payment-intent');

// ---------------------------------------------------------------------------
// Minimal req/res stubs
// ---------------------------------------------------------------------------

function makeReq(method = 'POST', body = {}) {
  return { method, headers: {}, body };
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

describe('POST /api/payment-intent', () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });

  afterAll(() => {
    process.env.STRIPE_SECRET_KEY = savedKey;
  });

  test('returns 503 when STRIPE_SECRET_KEY is not set', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'hard' }), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/not configured/i);
  });

  test('returns 400 for missing packId', async () => {
    const res = makeRes();
    await handler(makeReq('POST', {}), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/packId/i);
  });

  test('returns 400 for unknown packId', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'unknown' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/packId/i);
  });

  test('returns 200 with clientSecret on success', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'hard' }), res);
    expect(res._status).toBe(200);
    expect(res._body.clientSecret).toBe('pi_test_secret_xxx');
  });

  test('returns 200 with clientSecret for expert pack', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'expert' }), res);
    expect(res._status).toBe(200);
    expect(res._body.clientSecret).toBe('pi_test_secret_xxx');
  });

  test('returns 200 with clientSecret for archive pack', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'archive' }), res);
    expect(res._status).toBe(200);
    expect(res._body.clientSecret).toBe('pi_test_secret_xxx');
  });

  test('returns 405 for GET', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res._status).toBe(405);
  });

  test('returns 204 for OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(res._status).toBe(204);
  });

  test('returns 500 when Stripe throws', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        create: jest.fn().mockRejectedValue(new Error('Stripe network error')),
      },
    }));
    const res = makeRes();
    await handler(makeReq('POST', { packId: 'hard' }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/failed to create/i);
  });

  test('returns 400 for invalid JSON body when body is null', async () => {
    // Simulate a request with no pre-parsed body and no stream — body is null
    // parseJsonBody returns null body, packId will be undefined → 400
    const req = { method: 'POST', headers: {}, body: null };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});
