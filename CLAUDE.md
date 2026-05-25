# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Lint (required before every commit/push)
npm run lint                          # ESLint — api/, lib/, scripts/, tests/, public/
npm run lint:fix                      # auto-fix safe issues

# Run tests (required before every commit/push)
npm test                              # Jest — all suites
npm run test:coverage                 # same, with coverage report

# Local dev server (must use CLI directly — no npm run dev)
vercel dev                            # → http://localhost:3000

# Generate today's puzzle against local dev server
npm run bootstrap                     # reads CRON_SECRET + API_URL from .env.local

# Generate against production
CRON_SECRET='...' API_URL=https://your-app.vercel.app node scripts/bootstrap.js

# Deploy
vercel --prod

# Pull env vars from Vercel into .env.local
vercel env pull .env.local
```

There is no lint step and no build step — `public/` is served as-is.

## No Emoji Policy

Never use emoji in code, UI text, toast messages, or comments. Where a visual indicator is needed, use a simple clean SVG icon file in `public/icons/` and reference it with `<img src="/icons/name.svg" class="icon" alt="" aria-hidden="true">`. Existing icons: `flame.svg`, `packs.svg`, `settings.svg`, `practice.svg`, `loyal.svg`, `hard.svg`, `expert.svg`, `archive.svg`, `lock.svg`.

## Testing Requirements

**All new code must pass lint (`npm run lint`) and be fully unit tested (`npm test`) before being committed.** Tests live in `tests/` and run with Jest (CommonJS, no transform). CI enforces passing tests on every push via `.github/workflows/ci.yml`.

| Test file | What it covers |
|---|---|
| `tests/generator.test.js` | All exported functions in `lib/generator.js` — 40+ assertions verifying pool size, uniqueness, solution validity, and algorithm invariants |
| `tests/api-today.test.js` | `api/today.js` handler — auth headers, CORS, 503/200 paths, public blob read (no auth header) |
| `tests/api-generate.test.js` | `api/generate.js` handler — auth, idempotency, generation, blob write options, all error paths |
| `tests/api-config.test.js` | `api/config.js` handler — GET, CORS, 405, env set/unset |
| `tests/api-payment-intent.test.js` | `api/payment-intent.js` handler — 503/400/405/200/500 paths |
| `tests/api-fulfill.test.js` | `api/fulfill.js` handler — 503/400/402/405/200, idempotency, blob write, Stripe errors |
| `tests/utils.test.js` | `lib/utils.js` — `utcDateString`, `parseJsonBody` (stream, pre-parsed object, string, invalid JSON) |

**Linting:** ESLint v9 flat config (`eslint.config.js`). Rules: `@eslint/js` recommended. Three environments: `api/`, `lib/`, `scripts/`, `tests/` use Node globals; `tests/` also gets Jest globals; `public/` uses browser globals. Use `Object.hasOwn(obj, key)` instead of `obj.hasOwnProperty(key)`. Unused catch bindings use bare `catch {}` (no `(err)`).

**Mocking patterns:**

- `@vercel/blob`: `jest.mock('@vercel/blob', () => ({ list: jest.fn(), put: jest.fn() }))`
- API req/res: plain stub objects with `status()`, `json()`, `setHeader()`, `end()` chainable methods; check `res._status` and `res._body`
- `global.fetch`: assign `jest.fn()` in `beforeEach`; override per-test with `.mockResolvedValue({ json: jest.fn().mockResolvedValue(data) })`
- `lib/generator` (in API tests): `jest.mock('../lib/generator', () => ({ generatePuzzle: jest.fn() }))`
- `stripe`: `jest.mock('stripe', () => jest.fn(() => ({ paymentIntents: { create: jest.fn(), retrieve: jest.fn() } })))`

Set `jest.setTimeout(15000)` in `tests/generator.test.js` — `generatePuzzle` runs the full P(10,5) uniqueness check and needs the headroom.

## Sub-Agents

Three project-specific agents live in `.claude/agents/`. Create them with the content below if they are missing.

**`.claude/agents/frontend-dev.md`** — for work in `public/`:
```
---
name: frontend-dev
description: Use for any work touching public/ — app.js, styles.css, index.html. Knows the Reckon SPA patterns, pool tile system, animation model, localStorage state, pack mode, and Vercel static serving.
---

You are a frontend specialist for the Reckon daily math puzzle app. No framework, no build step — plain JS/HTML/CSS in `public/`.

No emoji anywhere in the codebase. Use SVG icons from `public/icons/` instead.

Core patterns:

Operations stored as ASCII (+, -, *, /) and displayed via OP_DISPLAY as Unicode (+, −, ×, ÷). Pool tiles use split .op-sym (operator) + .op-num (operand) spans. The data-op attribute drives CSS family accent colours: blue for +/-, amber for */÷. The .op-sym color is set via CSS attribute selectors ([data-op="+"] etc.) and is overridden to inherit when the tile has a feedback state class.

State localStorage keys:
- reckon:state — daily guesses, streak, history, settings
- reckon:puzzle — today's fetched puzzle (keyed by UTC date to detect day rollover)
- reckon:packs — pack game state, progress per pack, unlocked keys

Pack mode: enterPackMode(packId, puzzleIndex) temporarily swaps gameState.today with a reference into packState.progress[packId].games[puzzleIndex]. All existing render/submit functions work unchanged. exitPackMode() restores the daily puzzle from localStorage. saveState() is pack-aware — it calls savePackState() when packMode.active is true.

Keyboard: 1–9 → pool[0–8], 0 → pool[9], Backspace removes, Enter submits.

Animations: tile flip uses Promise.all with per-tile staggered delays — never sequential await in a loop.

Win condition: Math.abs(result - target) < 1e-9, not all-green feedback.

CSS: feedback colours (--color-green/yellow/gray) and pool family colours (--pool-add-*, --pool-mul-*) are CSS variables with dark-mode overrides in html.dark. Pool layout is a 5-column CSS grid (#pool-tiles), not flexbox. SVG icons in <img> tags use `filter: invert(1)` in html.dark to appear white on dark backgrounds.

Embedded Stripe checkout: startCheckout(packId) fetches publishable key from /api/config, creates a PaymentIntent via /api/payment-intent, mounts Stripe Payment Element in #checkout-modal, calls stripe.confirmPayment({ redirect: 'if_required' }) on submit, then calls /api/fulfill with paymentIntentId to get the license key.

Vercel static: public/ is served as-is; API calls go to /api/today (same-origin). app.js receives the full puzzle including solution and caches it in localStorage — this is by design (SPEC.md §4.7) for the loss-reveal feature.

All new frontend code must have corresponding tests in tests/.
```

**`.claude/agents/backend-dev.md`** — for work in `api/`, `lib/`, `scripts/`, `vercel.json`:
```
---
name: backend-dev
description: Use for any work in api/, lib/generator.js, vercel.json, or scripts/. Knows the puzzle generation algorithm, Vercel Blob storage, cron setup, pack system, Stripe payment flow, and puzzle privacy rules.
---

You are a backend specialist for the Reckon daily math puzzle app. Stack: Vercel Serverless Functions + Vercel Blob + Vercel Cron + Stripe.

Puzzle generation (lib/generator.js):

Pool = 5 solution ops + 5 decoys = 10 total. Uniqueness enforced: exactly one ordered 5-permutation of the 10-op pool produces target (P(10,5) = 30,240 checks).

generateDecoys(solution, start, target) adds decoys incrementally — each candidate is only accepted if isUnique(start, target, growingPool) returns true. NEVER revert to random blind selection; P(10,5) with blind checking fails ~100% of the time.

permutations() is a plain recursive array function (not a generator function) — required for Vercel's serverless sandbox.

Storage: blobs at puzzles/YYYY-MM-DD.json, access: 'public', addRandomSuffix: false, allowOverwrite: true. Read via list({ prefix }) + fetch(blob.url) with no auth header (public store). Pack puzzles at packs/{packId}/puzzles.json. Licenses at licenses/{KEY}.json. Stripe fulfillment idempotency at sessions/pi_{id}.json.

Auth: /api/generate requires Authorization: Bearer ${CRON_SECRET}. Cron fires at 00:05 UTC via vercel.json.

CRITICAL — Puzzle privacy: NEVER log start, target, pool, or solution. Only log { date, puzzleNumber, message }. See SPEC.md §4.7.

LAUNCH_DATE must be kept in sync between api/generate.js and public/app.js.

Pack payment flow:
1. POST /api/payment-intent { packId } → creates Stripe PaymentIntent, returns { clientSecret }
2. Frontend mounts Payment Element, user pays
3. POST /api/fulfill { paymentIntentId } → verifies PI succeeded with Stripe, generates RCKN key, writes licenses/{key}.json + sessions/pi_{id}.json (idempotent), returns { key, packId }
4. POST /api/redeem { key, packId } → validates key, marks redeemedAt, returns pack info

License key format: RCKN-XXXX-XXXX-XXXX, charset ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no I, O, 0, 1 — confusable).

parseJsonBody(req) in lib/utils.js handles both vercel dev (pre-parsed req.body) and production (raw stream). Always use it instead of inline stream reading.

All new backend code must have corresponding tests in tests/.
```

**`.claude/agents/test-engineer.md`** — for writing or fixing tests:
```
---
name: test-engineer
description: Use for writing or fixing tests in tests/. Knows Jest patterns, how to mock @vercel/blob, stripe, and the API req/res interface, and what invariants to assert for the puzzle generator and pack payment flow.
---

You are the test engineer for the Reckon daily math puzzle app. Test framework: Jest (CommonJS, no transform).

Files: tests/generator.test.js, tests/api-today.test.js, tests/api-generate.test.js, tests/api-config.test.js, tests/api-payment-intent.test.js, tests/api-fulfill.test.js, tests/utils.test.js.

Mocking @vercel/blob:
  jest.mock('@vercel/blob', () => ({ list: jest.fn(), put: jest.fn() }));

Mocking stripe:
  jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
  })));
  const Stripe = require('stripe');
  const mockStripe = Stripe();
  // then: mockStripe.paymentIntents.create.mockResolvedValue({...})

Mocking Vercel API req/res: plain stubs with status(), json(), setHeader(), end() methods that return this. Assert on res._status and res._body.

Mocking global fetch: set global.fetch = jest.fn() in beforeEach. Per-test: global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(data) }).

Mocking lib/generator in API tests:
  jest.mock('../lib/generator', () => ({ generatePuzzle: jest.fn() }));

Generator test invariants: pool has 10 ops, solution has 5, all pool ops distinct, solution is subset of pool, applyAll(start, solution) equals target within 1e-9, isUnique(start, target, pool) is true.

Non-unique test trick: a pool of only +/- ops where every ordering gives the same net sum (additive commutativity) → isUnique returns false.

Set jest.setTimeout(15000) at the top of generator tests.

Save and restore process.env.CRON_SECRET around api/generate tests (beforeEach sets it, afterAll restores it).
Save and restore process.env.STRIPE_SECRET_KEY around payment-intent and fulfill tests.

Run npm test before declaring any work done.
```

## Architecture

```
vercel.json cron (00:05 UTC)
  → POST /api/generate  [Bearer $CRON_SECRET]
      → lib/generator.js  (crypto.randomBytes, never seeded)
          → Vercel Blob  puzzles/YYYY-MM-DD.json  (access: 'public')

GET /api/today  (public)
  → public/app.js  (caches puzzle in localStorage: reckon:puzzle)

GET /api/config  (public)
  → returns { stripePk } — safe to expose

GET /api/packs  (public)
  → returns { packs: [...] } from lib/packs.js

GET /api/pack-puzzles?packId=X&index=N  (public)
  → reads packs/{packId}/puzzles.json from Blob, returns puzzle at index

POST /api/payment-intent  { packId }
  → creates Stripe PaymentIntent, returns { clientSecret }

POST /api/fulfill  { paymentIntentId }
  → verifies PI with Stripe, generates RCKN key, stores in Blob (idempotent)
  → returns { key, packId }

POST /api/redeem  { key, packId }
  → validates RCKN key in Blob, marks redeemed, returns pack info

POST /api/webhook  [Stripe-Signature header]
  → handles payment_intent.succeeded for email delivery (Resend)
  → NOT used for key generation (that's /api/fulfill)

POST /api/checkout  (legacy — kept for backwards compat, not used by current frontend)
```

**No framework, no build.** `public/` is a vanilla JS SPA. `api/` contains Vercel Serverless Functions. `lib/` contains shared Node.js modules.

## Puzzle Generation (`lib/generator.js`)

The generator is the heart of the app. Key invariants:

- **Pool size:** 10 ops (5 solution + 5 decoys). Players see 10 tiles; must pick and order 5.
- **Uniqueness:** exactly one ordered 5-permutation of the 10-op pool hits `target`. Enforced by `isUnique()` which brute-forces all P(10,5) = 30,240 orderings.
- **Decoy strategy:** `generateDecoys(solution, start, target)` adds decoys *incrementally* — each candidate is rejected immediately if it would create a second valid path to `target`. This keeps the pass rate near 100% (~0.35s per puzzle). **Do not switch back to random blind selection** — P(10,5) uniqueness with blind selection has a ~0% pass rate.
- **No seed.** `randInt()` uses `crypto.randomBytes`. Nothing is logged or persisted about the random entropy. Even the developer cannot predict tomorrow's puzzle.
- `permutations()` is a plain recursive array function (not a generator function) — required for Vercel's serverless sandbox.

## Storage (`api/today.js`, `api/generate.js`)

- Blob store must be configured as **public** in the Vercel dashboard.
- Blobs are stored at `puzzles/YYYY-MM-DD.json` with `addRandomSuffix: false`.
- `api/today.js` reads via `list({ prefix })` + `fetch(blob.url)` (no auth header — public store).
- `api/generate.js` writes via `put(pathname, body, { access: 'public', allowOverwrite: true })`.
- Pack puzzles stored at `packs/{packId}/puzzles.json`.
- License keys stored at `licenses/{KEY}.json`.
- Stripe PI fulfillment idempotency stored at `sessions/pi_{piId}.json`.

## Strict Rule: Never Log Puzzle Contents

`api/generate.js` and `scripts/bootstrap.js` must **never** log `start`, `target`, `pool`, or `solution`. Log only `{ date, puzzleNumber, message }`. This is intentional puzzle-privacy design (SPEC.md §4.7).

## Frontend State (`public/app.js`)

Three `localStorage` keys:
- `reckon:state` — daily guesses, streak, history, settings
- `reckon:puzzle` — today's fetched puzzle (keyed by UTC date to detect day rollover)
- `reckon:packs` — pack game state, progress, unlocked keys

**Operations** are stored internally as ASCII (`+`, `-`, `*`, `/`) and displayed as Unicode (`+`, `−`, `×`, `÷`) via `OP_DISPLAY`. The pool tiles split the operator and operand into `.op-sym` and `.op-num` spans, styled by `data-op` attribute for family accent colours (blue = additive, amber = multiplicative). The `.op-sym` color is overridden to `inherit` when the tile has a feedback state class.

Keyboard shortcuts: keys `1`–`9` map to pool indices 0–8; key `0` maps to index 9.

**Pack mode:** `enterPackMode(packId, puzzleIndex)` swaps `gameState.today` with a pack game object reference. All render/submit functions work unchanged. `exitPackMode()` restores the daily puzzle. `saveState()` routes to `savePackState()` when `packMode.active` is true.

**Embedded Stripe checkout:** `startCheckout(packId)` → fetches `STRIPE_PUBLISHABLE_KEY` from `/api/config` → creates PaymentIntent via `/api/payment-intent` → mounts Payment Element in `#checkout-modal` → on submit calls `stripe.confirmPayment({ redirect: 'if_required' })` → calls `/api/fulfill` with `paymentIntentId` → stores key in `packState` → shows purchase success modal.

## Key Constants

| Constant | File | Value |
|---|---|---|
| `LAUNCH_DATE` | `api/generate.js` | `'2026-05-23'` (puzzle #1) |
| `LAUNCH_DATE` | `public/app.js` | `'2026-05-23'` (share text `#N`) |
| App URL in share text | `public/app.js` `generateShareText()` | `window.location.host` (dynamic — no hardcoded domain) |
| Source code link | `public/index.html` `#source-link` | update before launch |
| Cron schedule | `vercel.json` | `"5 0 * * *"` (00:05 UTC) |

## Required Environment Variables

| Var | Where set | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard (auto via Blob store integration) | Blob read/write |
| `CRON_SECRET` | Vercel dashboard → Settings → Env Vars | Protects `/api/generate` |
| `STRIPE_SECRET_KEY` | Vercel dashboard → Settings → Env Vars | Stripe API — server-side only |
| `STRIPE_PUBLISHABLE_KEY` | Vercel dashboard → Settings → Env Vars | Stripe — returned by `/api/config`, safe to expose |
| `STRIPE_WEBHOOK_SECRET` | Vercel dashboard → Settings → Env Vars | Stripe webhook signature verification |
| `RESEND_API_KEY` | Vercel dashboard → Settings → Env Vars | Email delivery (purchase confirmation) |
| `RESEND_FROM_EMAIL` | Vercel dashboard → Settings → Env Vars | From address for purchase emails |

All must be present in `.env.local` for local dev (`vercel env pull .env.local`).

## Git Remote

This repo uses a multi-account SSH alias. Push with:
```bash
git push git@github.com-personal:jlowenthal/reckon.git main
```
