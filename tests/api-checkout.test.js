'use strict';

// Mock stripe module
jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
      },
    },
  }));
});

function makeReq(body) {
  return {
    method: 'POST',
    url: 'http://localhost/api/checkout',
    headers: { host: 'localhost', 'x-forwarded-host': null },
    [Symbol.asyncIterator]: async function* () {
      if (body) yield Buffer.from(JSON.stringify(body));
    },
  };
}

function makeRes() {
  const res = {
    _status: 200, _body: null, _headers: {},
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b; return this; },
    end()     { return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
  };
  return res;
}

describe('POST /api/checkout', () => {
  const handler = require('../api/checkout');

  let savedEnv;
  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.STRIPE_SECRET_KEY  = 'sk_test_fake';
    process.env.STRIPE_PRICE_HARD  = 'price_test_hard';
    process.env.STRIPE_PRICE_EXPERT = 'price_test_expert';
    process.env.STRIPE_PRICE_ARCHIVE = 'price_test_archive';
  });
  afterAll(() => { process.env = savedEnv; });

  it('returns 503 when STRIPE_SECRET_KEY is not set', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = makeRes();
    await handler(makeReq({ packId: 'hard' }), res);
    expect(res._status).toBe(503);
  });

  it('returns 400 for unknown packId', async () => {
    const res = makeRes();
    await handler(makeReq({ packId: 'unknown' }), res);
    expect(res._status).toBe(400);
  });

  it('returns 200 with Stripe checkout URL on success', async () => {
    const res = makeRes();
    await handler(makeReq({ packId: 'hard' }), res);
    expect(res._status).toBe(200);
    expect(res._body.url).toContain('stripe.com');
  });

  it('returns 405 for GET', async () => {
    const req = { method: 'GET', url: 'http://localhost/api/checkout', headers: {}, [Symbol.asyncIterator]: async function*() {} };
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});
