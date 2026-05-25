'use strict';

jest.mock('@vercel/blob', () => ({
  list: jest.fn(),
  put:  jest.fn(),
}));

jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: {
    retrieve: jest.fn(),
  },
})));

const { list, put } = require('@vercel/blob');
const handler = require('../api/fulfill');

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

describe('POST /api/fulfill', () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    // Default: no existing session blob
    list.mockResolvedValue({ blobs: [] });
    // Default: put succeeds
    put.mockResolvedValue({ url: 'https://blob.example.com/x.json' });
  });

  afterAll(() => {
    process.env.STRIPE_SECRET_KEY = savedKey;
  });

  // --- Auth / env ---

  test('returns 503 when STRIPE_SECRET_KEY is not set', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_abc' }), res);
    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/not configured/i);
  });

  // --- Validation ---

  test('returns 400 for missing paymentIntentId', async () => {
    const res = makeRes();
    await handler(makeReq('POST', {}), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/paymentIntentId/i);
  });

  test('returns 400 for invalid format (no pi_ prefix)', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'ch_notaPI' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/paymentIntentId/i);
  });

  // --- Idempotency ---

  test('returns 200 from idempotency cache when already fulfilled', async () => {
    const cached = { key: 'RCKN-TEST-TEST-TEST', packId: 'hard' };
    list.mockResolvedValue({ blobs: [{ url: 'https://blob.example.com/session.json' }] });
    global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(cached) });

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_already_done' }), res);
    expect(res._status).toBe(200);
    expect(res._body.key).toBe('RCKN-TEST-TEST-TEST');
    expect(res._body.packId).toBe('hard');
    // Should not have called put (no new key generated)
    expect(put).not.toHaveBeenCalled();
  });

  // --- Stripe verification ---

  test('returns 402 when PaymentIntent status is not succeeded', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          status: 'requires_payment_method',
          metadata: { packId: 'hard' },
        }),
      },
    }));

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_pending' }), res);
    expect(res._status).toBe(402);
    expect(res._body.error).toMatch(/not completed/i);
  });

  test('returns 400 when Stripe retrieve throws', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockRejectedValue(new Error('No such payment_intent')),
      },
    }));

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_notfound' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid payment intent/i);
  });

  test('returns 400 when packId in metadata is invalid', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          status: 'succeeded',
          metadata: { packId: 'bogus' },
          id: 'pi_bogus',
        }),
      },
    }));

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_bogus' }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid pack/i);
  });

  // --- Successful fulfillment ---

  test('returns 200 with key and packId on new successful fulfillment', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          status: 'succeeded',
          metadata: { packId: 'hard' },
        }),
      },
    }));

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_success' }), res);
    expect(res._status).toBe(200);
    expect(res._body.packId).toBe('hard');
    expect(res._body.key).toMatch(/^RCKN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Should write license blob + session blob
    expect(put).toHaveBeenCalledTimes(2);
  });

  test('stores license blob with correct options', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          status: 'succeeded',
          metadata: { packId: 'expert' },
        }),
      },
    }));

    await handler(makeReq('POST', { paymentIntentId: 'pi_opts' }), makeRes());

    const [licensePath, licenseBody, licenseOpts] = put.mock.calls[0];
    expect(licensePath).toMatch(/^licenses\/RCKN-/);
    const doc = JSON.parse(licenseBody);
    expect(doc.packId).toBe('expert');
    expect(doc.type).toBe('purchase');
    expect(licenseOpts.access).toBe('public');
    expect(licenseOpts.addRandomSuffix).toBe(false);
    expect(licenseOpts.allowOverwrite).toBe(false);
  });

  test('returns 500 when blob write throws', async () => {
    const stripe = require('stripe');
    stripe.mockImplementationOnce(() => ({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          status: 'succeeded',
          metadata: { packId: 'archive' },
        }),
      },
    }));
    put.mockRejectedValue(new Error('blob write failed'));

    const res = makeRes();
    await handler(makeReq('POST', { paymentIntentId: 'pi_bloberr' }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/storage/i);
  });

  // --- Method ---

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
});
