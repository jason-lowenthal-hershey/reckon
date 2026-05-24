'use strict';

jest.mock('@vercel/blob', () => ({
  list: jest.fn(),
  put: jest.fn(),
}));

jest.mock('../lib/generator', () => ({
  generatePuzzle: jest.fn(),
}));

const { list, put } = require('@vercel/blob');
const { generatePuzzle } = require('../lib/generator');
const handler = require('../api/generate');

// ---------------------------------------------------------------------------
// Minimal req/res stubs
// ---------------------------------------------------------------------------

function makeReq(method = 'GET', headers = {}) {
  return { method, headers };
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

const VALID_AUTH = { authorization: 'Bearer test-secret' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/generate', () => {
  const savedSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    process.env.CRON_SECRET = 'test-secret';
  });

  afterAll(() => {
    process.env.CRON_SECRET = savedSecret;
  });

  // --- Auth ----------------------------------------------------------------

  test('returns 401 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);
    expect(res._status).toBe(401);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const res = makeRes();
    await handler(makeReq('GET', {}), res);
    expect(res._status).toBe(401);
  });

  test('returns 401 when token is wrong', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { authorization: 'Bearer wrong' }), res);
    expect(res._status).toBe(401);
  });

  // --- Method --------------------------------------------------------------

  test('returns 405 for non-GET methods (with valid auth)', async () => {
    const res = makeRes();
    await handler(makeReq('POST', VALID_AUTH), res);
    expect(res._status).toBe(405);
  });

  // --- Idempotency ---------------------------------------------------------

  test('returns 200 with "already exists" message when puzzle was already generated today', async () => {
    const existing = { puzzleNumber: 2 };
    list.mockResolvedValue({ blobs: [{ url: 'https://blob.example.com/p.json' }] });
    global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(existing) });

    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);

    expect(res._status).toBe(200);
    expect(res._body.message).toMatch(/already exists/i);
    expect(res._body.puzzleNumber).toBe(2);
    // Must not call generatePuzzle — it's already done
    expect(generatePuzzle).not.toHaveBeenCalled();
  });

  // --- Successful generation -----------------------------------------------

  test('generates and stores a new puzzle when none exists for today', async () => {
    list.mockResolvedValue({ blobs: [] });
    generatePuzzle.mockReturnValue({
      start: 10, target: 73, pool: [], solution: [], puzzleNumber: 1,
    });
    put.mockResolvedValue({ url: 'https://blob.example.com/p.json' });

    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);

    expect(res._status).toBe(200);
    expect(res._body.message).toMatch(/successfully/i);
    expect(generatePuzzle).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test('stores the puzzle at puzzles/YYYY-MM-DD.json with public access', async () => {
    list.mockResolvedValue({ blobs: [] });
    generatePuzzle.mockReturnValue({
      start: 5, target: 50, pool: [], solution: [], puzzleNumber: 3,
    });
    put.mockResolvedValue({});

    await handler(makeReq('GET', VALID_AUTH), makeRes());

    const [pathname, , opts] = put.mock.calls[0];
    expect(pathname).toMatch(/^puzzles\/\d{4}-\d{2}-\d{2}\.json$/);
    expect(opts.access).toBe('public');
    expect(opts.addRandomSuffix).toBe(false);
    expect(opts.allowOverwrite).toBe(true);
  });

  test('stored document does NOT include raw entropy fields only (has expected keys)', async () => {
    list.mockResolvedValue({ blobs: [] });
    generatePuzzle.mockReturnValue({
      start: 7, target: 42, pool: [{ operator: '+', operand: 3 }], solution: [], puzzleNumber: 5,
    });
    put.mockResolvedValue({});

    await handler(makeReq('GET', VALID_AUTH), makeRes());

    const stored = JSON.parse(put.mock.calls[0][1]);
    expect(stored).toHaveProperty('_id');
    expect(stored).toHaveProperty('puzzleNumber');
    expect(stored).toHaveProperty('start');
    expect(stored).toHaveProperty('target');
    expect(stored).toHaveProperty('pool');
    expect(stored).toHaveProperty('solution');
    expect(stored).toHaveProperty('createdAt');
  });

  // --- Error handling ------------------------------------------------------

  test('returns 500 when the blob list call throws', async () => {
    list.mockRejectedValue(new Error('blob error'));
    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);
    expect(res._status).toBe(500);
  });

  test('returns 500 when puzzle generation throws', async () => {
    list.mockResolvedValue({ blobs: [] });
    generatePuzzle.mockImplementation(() => { throw new Error('gen failed'); });
    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);
    expect(res._status).toBe(500);
  });

  test('returns 500 when blob write throws', async () => {
    list.mockResolvedValue({ blobs: [] });
    generatePuzzle.mockReturnValue({
      start: 10, target: 20, pool: [], solution: [], puzzleNumber: 1,
    });
    put.mockRejectedValue(new Error('write error'));
    const res = makeRes();
    await handler(makeReq('GET', VALID_AUTH), res);
    expect(res._status).toBe(500);
  });
});
