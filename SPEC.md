# Reckon — Build Spec

A daily math puzzle web app. Players assemble 5 operations in order to transform a starting number into a target. Wordle-style feedback, daily reset, streak tracking, spoiler-safe share grid.

This document is the authoritative spec. When an implementation choice isn't specified, default to "what Wordle does."

---

## 1. Product Summary

**One-line pitch:** Wordle, but with arithmetic — pick 5 of 7 operation tiles, order them, hit the target.

**Audience:** Players who like Wordle, NYT Connections, Geogrid. Shared with friends via copy-paste grids.

**Platform:** Single-page application (SPA) frontend + minimal backend for puzzle generation and serving. Frontend hostable on any static host (GitHub Pages, Netlify, Vercel). Backend is MongoDB Atlas + Atlas App Services (Triggers + Functions + HTTPS endpoint) — see §4.6.

**Puzzle privacy:** Puzzles are generated server-side using **true randomness** (`crypto.randomBytes`), stored in MongoDB, and served via a read-only API that returns only the current day's puzzle. The seed is never persisted, so even the developer cannot predict future puzzles from the source code alone. See §4.7 for the full threat model.

**Core loop:** One puzzle per day, same for every player globally. Player has 6 guesses. Win → streak increments, share grid generated. Loss → streak resets. Next puzzle unlocks at local midnight.

---

## 2. Game Mechanics

### 2.1 Puzzle structure

Each daily puzzle has:

| Field | Type | Example |
|---|---|---|
| `start` | integer | `10` |
| `target` | integer | `73` |
| `pool` | array of 7 operations | `[×2, +3, ×3, −2, +6, ÷5, −1]` |
| `solution` | ordered array of 5 ops drawn from pool | `[×2, +3, ×3, −2, +6]` |

An **operation** is `(operator, operand)` where:
- `operator` ∈ `{+, −, ×, ÷}`
- `operand` is a positive integer in `[2, 9]`

All 7 operations in the pool are **distinct** (no duplicate `(operator, operand)` pairs). This keeps feedback unambiguous in v1.

### 2.2 Applying a sequence

Given `start` and an ordered list of operations `[op₁, op₂, …, opₙ]`, compute left-to-right:

```
v₀ = start
v₁ = apply(op₁, v₀)
v₂ = apply(op₂, v₁)
…
result = vₙ
```

Operations work on any real number. Division uses true (floating-point) division — `÷5` applied to `12` yields `2.4`. Player guesses may produce non-integer intermediates; that's fine, it just means they're off the solution path.

### 2.3 Win condition

A guess wins iff its result **equals the target** within floating-point tolerance (`|result − target| < 1e-9`).

The puzzle is solvable: the daily `solution` is guaranteed to produce `target` exactly with all-integer intermediates.

### 2.4 Guess limit

Player has **6 guesses**. Each guess is a complete ordering of 5 operations drawn from the pool.

---

## 3. Feedback System

After each guess, every operation slot gets one of three states:

- 🟩 **Green** — this operation appears in the solution at this exact slot
- 🟨 **Yellow** — this operation appears in the solution, but at a different slot
- ⬜ **Gray** — this operation is not in the solution

The numeric **result** of the guess is also shown next to the row in-game (hidden in the share grid — see §7).

### 3.1 Feedback algorithm (precise)

Because pool ops are distinct (per §2.1), no duplicate-handling is required.

```
function score(guess, solution):
    result = [_, _, _, _, _]
    solution_set = set(solution)        # which ops appear anywhere
    for i in 0..4:
        if guess[i] == solution[i]:
            result[i] = GREEN
        elif guess[i] in solution_set:
            result[i] = YELLOW
        else:
            result[i] = GRAY
    return result
```

Two operations are "equal" iff their `operator` and `operand` both match.

### 3.2 Worked example

```
Start: 10   Target: 73
Pool: [×2, +3, ×3, −2, +6, ÷5, −1]
Solution: [×2, +3, ×3, −2, +6]

Guess: [+3, ×3, ×2, +6, −2]
Eval:  10 → 13 → 39 → 78 → 84 → 82
Feedback: 🟨 🟨 🟨 🟨 🟨   result: 82
(all 5 ops are in the solution but none in correct slot)

Guess: [×2, +3, ×3, +6, −2]
Eval:  10 → 20 → 23 → 69 → 75 → 73
Feedback: 🟩 🟩 🟩 🟨 🟨   result: 73
Wait — result == target but slot order differs?
NO. If result equals target AND every slot is green, it's a win.
In this case the result coincidentally equals target via a different math path —
this is allowed and counts as a WIN regardless of slot colors.
```

**Important:** Winning is determined by `result == target`, NOT by all-green feedback. Multiple orderings *can* hit the target in principle; the generator ensures **only one** does (see §4.4), so in practice winning and all-green coincide. But the win check is on the numeric result, not the feedback.

---

## 4. Puzzle Generation

### 4.1 Randomness source

Puzzles are generated using **non-deterministic randomness**. There is no date-derived seed. There is no salt. There is no PRNG state to leak.

**At generation time** (server-side, see §4.6), the generator function uses Node's `crypto.randomBytes` (or equivalent CSPRNG) for every choice — start number, operation selection, operand selection, decoy selection. The random bytes are consumed and discarded; nothing about the entropy source is persisted.

```js
// Example: pick a random integer in [min, max] inclusive
function randInt(min, max) {
  const range = max - min + 1;
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return min + (n % range);
}
```

**Why this matters:**
- The repo can be fully open source. Anyone can read `generator.js` and understand the algorithm.
- Knowing the algorithm doesn't help, because the only thing that determines the output is the random bytes drawn at generation time — and those exist only inside the running function for a few milliseconds, then are gone.
- Even the developer, with full access to the source code and database, cannot predict tomorrow's puzzle. They can only see it after tomorrow's cron job runs.

### 4.2 Solution generation

1. Choose `start` uniformly from `[5, 20]`.
2. Build the 5-op solution one op at a time:
   - At each step, randomly pick `(operator, operand)` from the legal set such that:
     - Applying it to the current value yields a **positive integer**
     - The op hasn't been used yet in the solution
   - If no legal op exists, backtrack one step (this is rare with reasonable constraints).
3. Enforce solution composition:
   - At least one multiplicative op (`×` or `÷`)
   - At least one additive op (`+` or `−`)
   - At most three of any single operator family
4. `target = apply_all(start, solution)`. Require `target ∈ [20, 250]`; otherwise regenerate.

### 4.3 Decoy generation

Add 2 more ops to the pool (total 7) such that:
- Each decoy is distinct from every other pool op
- Decoy operands are within `[2, 9]`
- The pool has reasonable visual variety (don't make all 7 ops `+n` for various `n`)

### 4.4 Uniqueness validation

This is the most important step. Generated puzzles are only valid if **exactly one ordering** of 5 ops drawn from the 7-op pool produces `target`.

```
function isUnique(start, target, pool):
    count = 0
    for each ordered 5-permutation P of pool:   // P(7,5) = 2520
        if apply_all(start, P) == target:
            count += 1
            if count > 1: return false
    return count == 1
```

If not unique, **discard and regenerate from step 4.2**. With these constraints, ~70–90% of generations are unique on first try, so the loop terminates quickly. Cap retries at 200; if exceeded, broaden ranges and try again.

The check uses `|result − target| < 1e-9` for floating-point safety.

### 4.5 Difficulty

V1 ships a single moderate difficulty. The generator parameters above produce puzzles roughly equivalent to Wordle's median solve rate. No per-day difficulty escalation in v1.

### 4.6 Backend architecture (generation pipeline)

**Stack: MongoDB Atlas + Atlas App Services.** One platform, one bill ($0 on free tier for this workload), no external services to glue together.

#### Components

1. **MongoDB collection: `puzzles`**
   ```js
   {
     _id: "2026-05-23",            // UTC date, ISO format
     puzzleNumber: 142,            // days since launch, integer
     start: 10,
     target: 73,
     pool: [...],                  // 7 operations
     solution: [...],              // 5 operations (used for loss-reveal)
     createdAt: ISODate(...)
   }
   ```
   Indexed by `_id` (default). Documents are immutable once written.

2. **Scheduled Trigger: `daily-puzzle-generation`**
   - Schedule: every day at `00:05 UTC` (5-minute buffer after midnight to avoid clock-skew edge cases).
   - Calls Function: `generatePuzzle`.

3. **Atlas Function: `generatePuzzle`** (internal, not exposed publicly)
   - Computes today's UTC date `D`.
   - If a document with `_id === D` already exists, exits (idempotent).
   - Otherwise: runs the generator (§4.2–§4.4) using `crypto.randomBytes`, computes `puzzleNumber = daysSinceLaunch(D)`, inserts the document.
   - Logs success/failure to Atlas's built-in logging. On generation failure (e.g., retries exhausted in §4.4), retries up to 3 times then alerts (Atlas can send email on function errors).

4. **Atlas Function: `getTodaysPuzzle`** (exposed as HTTPS endpoint)
   - Route: `GET https://{app-id}.mongodb-realm.com/api/today`
   - Computes today's UTC date `D`.
   - Returns the document with `_id === D`, omitting nothing (yes, including `solution` — see §4.7).
   - If no document exists for `D` (e.g., trigger hasn't run yet or failed), returns 503 with a friendly message. The SPA shows "Today's puzzle is being prepared, please refresh in a moment."
   - **Never accepts a date parameter.** The endpoint only returns whatever the server considers "today." This prevents fetching arbitrary future puzzles from the API.
   - Permissive CORS for the production frontend domain.
   - No authentication. Public read. Rate-limit at the App Services level (e.g., 60 req/min per IP) to deter scraping abuse.

5. **Bootstrap: backfill script**
   - One-time script run at project setup that generates puzzles for the launch day and (optionally) a few days forward to handle any trigger setup hiccups.
   - **Critical:** if you want to preserve the "developer can't predict" property, run the backfill from a context where you don't capture the output. Easiest: run it as an Atlas Function from the Atlas UI, never see the result.
   - Alternative: backfill only the launch day, then trust the daily trigger from there.

### 4.7 Puzzle privacy

**Threat model:** This is an open-source project. Players might be technically curious friends. The developer themselves should be unable to spoil future puzzles for friends (even unintentionally).

**Guarantees:**

| Actor | Can they predict tomorrow's puzzle? | Why |
|---|---|---|
| Random visitor | No | Repo has algorithm but no data; algorithm requires runtime entropy. |
| Friend with DevTools | No (only sees today's) | API exposes only today's puzzle; never accepts date params. |
| Developer with full repo access | No | No deterministic seed anywhere in code. Random bytes are generated at cron time, never logged. |
| Developer with database read access | Sees today's, NOT future | Future puzzles don't exist in the DB until 00:05 UTC each day. |
| Developer who modifies the code | Could push a backdoor | But it's traceable in git history; assume developer is honest. |

**Operational rules to maintain these guarantees:**

1. The `generatePuzzle` function **must not log** the puzzle contents (start, target, pool, solution). Atlas function logs are visible to developers. Log only success/failure and the date.
2. **Do not capture or print the output** of any generation runs, including the bootstrap backfill. If you must inspect the database during development, look at *past* puzzles (yesterday or earlier), never today's-uncompleted or future entries.
3. Atlas database access should be limited via Atlas roles. The production cluster is for production; create a separate dev cluster if you need to inspect data without risking peeking at today's puzzle.
4. **No source maps in the production frontend bundle.** Source maps wouldn't reveal puzzle data (since the SPA doesn't have any), but it's good hygiene.
5. If you ever need to debug the generator, do it against a separate dev database with sample data — never against the production DB on a future date.

**What's intentionally NOT protected:**

- A friend who is currently playing today's puzzle can open DevTools, look at the Network tab, and find the solution in the API response. This is consistent with the "casual friends, not adversaries" model and matches what Wordle's frontend does too.
- The API has no auth, so anyone can `curl` it and see today's puzzle. They could write a script to do this every day and build a history. That's fine — they're still only ever getting today's, never future.

---

## 5. State & Persistence

All state in `localStorage`. The puzzle itself is fetched from the API and cached locally so we don't re-fetch on every reload.

Two keys are used:
- `reckon:state` — game state, streak, history, settings.
- `reckon:puzzle` — today's puzzle as fetched from the API (see §4.6).

**Fetch flow on app load:**

```
1. Compute today's UTC date D.
2. Read localStorage["reckon:puzzle"].
3. If cached.date === D: use cached puzzle, skip network.
4. Else:
     a. GET /api/today
     b. On success: write { date: D, puzzle: response } to localStorage, use it.
     c. On 503: show "puzzle preparing" message, offer retry button.
     d. On network error: if cached.date exists for a prior date, show
        "we're offline; here's an old puzzle for fun" (read-only, no streak credit).
        Otherwise show a connection error.
```

### 5.1 Schema

```js
// localStorage key: "reckon:state"
{
  version: 1,
  streak: {
    current: 7,
    best: 14,
    lastWinDate: "2026-05-22"   // ISO local date
  },
  today: {
    date: "2026-05-23",
    guesses: [
      { ops: [...], result: 82, feedback: ["Y","Y","Y","Y","Y"] },
      ...
    ],
    status: "in_progress" | "won" | "lost"
  },
  history: [
    { date: "2026-05-22", status: "won", guessCount: 4 },
    ...   // last 30 days, for stats panel
  ],
  settings: {
    colorBlindMode: false,
    hardMode: false   // see §10 stretch
  }
}

// localStorage key: "reckon:puzzle"
{
  date: "2026-05-23",
  puzzle: {
    start: 10,
    target: 73,
    pool: [...],
    solution: [...]
  }
}
```

### 5.2 Daily reset

On app load:
1. Compute today's UTC date `D`. (UTC, not local, because the backend defines "today" in UTC — see §4.6.)
2. If `state.today.date !== D`, archive the old `today` into `history` (if it exists) and clear `today`.
3. If `state.streak.lastWinDate` is more than 1 day before `D`, set `streak.current = 0`. (Streak survives across a single missed-day-of-resetting; it does NOT survive a missed day of *not winning*.)

**Streak rule:** Streak increments on win. Streak resets to 0 on a loss, or when the player opens the app on a day later than `lastWinDate + 1`.

Edge case: player wins, then doesn't open the app for 3 days, then opens it and wins → streak resets to 1, not continues from before. This matches Wordle's behavior.

### 5.3 No "cheating prevention"

Anyone can edit localStorage. Don't try to prevent it. This is a casual social game.

---

## 6. UI / UX Requirements

### 6.1 Layout (mobile-first, single column)

```
┌──────────────────────────────┐
│   RECKON         🔥 7   ⚙   │   ← header: title, streak badge, settings
├──────────────────────────────┤
│   Start: 10  →  Target: 73   │   ← big, central
├──────────────────────────────┤
│                              │
│  [guess row 1]      = 82     │
│  [guess row 2]      = 47     │
│  [guess row 3 ←]             │   ← current row, no result yet
│  [    ] [    ] [    ] [    ] [    ] ← empty slots
│  [    ] [    ] [    ] [    ] [    ]
│  [    ] [    ] [    ] [    ] [    ]
│                              │
├──────────────────────────────┤
│   POOL (tap to place)        │
│   [×2] [+3] [×3] [−2]        │
│   [+6] [÷5] [−1]             │
├──────────────────────────────┤
│         [ SUBMIT ]           │
└──────────────────────────────┘
```

### 6.2 Interactions

- **Placing ops:** Tap a pool tile to place it in the leftmost empty slot of the current row. Or drag (desktop). Or click an empty slot first, then click a pool tile.
- **Removing ops:** Tap a placed tile to send it back to the pool.
- **Pool tiles dim** when placed in the current row (visual cue that they're "used" for this guess). They become tappable again when removed.
- **Submit:** Enabled only when all 5 slots are filled. Submitting locks the row, computes feedback, animates tiles flipping to reveal colors (~100ms stagger per tile), then displays the numeric result.
- **Keyboard:** Number keys `1`–`7` place the corresponding pool tile. `Backspace` removes the last placed tile. `Enter` submits.

### 6.3 Visual feedback

- Color tokens:
  - Green: `#6aaa64` (Wordle's green)
  - Yellow: `#c9b458`
  - Gray: `#787c7e`
  - Background/text: light/dark mode aware
- **Color-blind mode** (toggle in settings): use blue/orange/gray with internal icons (✓ / ↺ / ✗) inside each tile.
- Flip animation on submit (CSS transform, ~600ms total).
- On win: confetti or similar small celebration; on loss: reveal solution as a final read-only row.

### 6.4 Modals / Screens

- **First-time onboarding modal:** 3-step explainer (here's the goal, here's a guess, here's the feedback).
- **Stats modal:** triggered by tapping streak badge. Shows current streak, best streak, total wins, guess-count distribution histogram (1–6, fail).
- **Settings modal:** color-blind toggle, dark mode toggle, link to "How to play", link to source code.
- **End-of-game modal:** auto-opens on win or loss. Shows result, share button, countdown to next puzzle.

### 6.5 Responsive

- Mobile: ≤480px wide, full-width tiles, single column.
- Tablet/desktop: max-width 500px content column, centered.
- Touch targets: minimum 44×44px.

### 6.6 Accessibility

- Semantic HTML (`<button>` for tiles, `<main>`, etc.)
- ARIA labels on tiles describing op and state (`"plus 3, currently in slot 2"`)
- Keyboard fully navigable
- Respect `prefers-reduced-motion` (skip flip animations)
- Color-blind mode (above)

---

## 7. Sharing

### 7.1 Format (spoiler-safe)

```
Reckon #142 — 4/6   🔥7
⬜🟨🟩🟩⬜
🟨🟩🟩🟨🟩
🟩🟩🟩🟨🟨
🟩🟩🟩🟩🟩

reckon.app
```

- Title line: puzzle number, score (`X/6` or `X/6` with X being guesses used, or `X/6` and a 💥 for fail), streak.
- Grid: one row per guess, emoji squares only — **no numbers, no operations**.
- Final line: app root URL. No deep link to a specific puzzle — recipients opening the link see whatever today's puzzle is on their device. The `#142` in the title line is cosmetic identification only.

Puzzle number `#N` is days since launch date (launch is day 1).

### 7.2 Share button behavior

```js
async function share(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch { /* user canceled, fall through */ }
  }
  await navigator.clipboard.writeText(text);
  showToast("Copied to clipboard!");
}
```

---

## 8. Tech Stack

### 8.1 Frontend

**Architecture:** SPA, fully client-side except for one API call per day to fetch today's puzzle. Deployed as static assets.

**Recommended:** Vanilla JS + HTML + CSS, no framework. The app is small enough that React/Vue add more weight than they save. Single `index.html`, single `app.js`, single `styles.css`.

**Acceptable alternatives:** Vite + React + TypeScript. Avoid Next.js or anything server-rendered.

**Dependencies:** None at runtime other than what the framework ships. No analytics, no fonts requiring CDN, no trackers.

**Build/deploy:** Standard static-site pipeline. Minify the production bundle. No source maps in production.

**Configuration:** The API URL is the only environment-specific value. Inject at build time via env var (e.g., `VITE_API_URL`) or define as a constant in source.

### 8.2 Backend

**Stack:** MongoDB Atlas (M0 free tier) + Atlas App Services (free tier).

**Components** (all defined as code in the repo where possible, see §8.3):
- 1 MongoDB collection (`puzzles`)
- 1 Scheduled Trigger (`daily-puzzle-generation`, fires at `00:05 UTC` daily)
- 1 Internal Function (`generatePuzzle`, called by the trigger)
- 1 HTTPS Endpoint Function (`getTodaysPuzzle`)
- 1 bootstrap script (manual one-time backfill)

**Why this stack:**
- Single platform (Atlas + App Services) means one set of credentials, one console, one bill.
- Free tier covers this workload indefinitely (one generation per day, light reads).
- Functions written in JavaScript — same language as the frontend.
- No separate API server, no separate cron service, no separate hosting.

**Alternative stacks** (if Atlas isn't preferred):
- Cloudflare Workers + Cloudflare KV + Cron Triggers — equally simple, also free tier friendly.
- Vercel/Netlify Functions + any MongoDB-compatible DB + external cron (e.g., cron-job.org).
- Self-hosted Node.js + MongoDB + node-cron — more control, more maintenance.

The spec is written for Atlas; the architecture (trigger → generator → DB → read endpoint) ports directly to any of these.

### 8.3 Repo structure

```
/
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── (build config)
├── backend/
│   ├── functions/
│   │   ├── generatePuzzle.js     # the generator (§4.2–§4.4)
│   │   └── getTodaysPuzzle.js    # read API
│   ├── triggers/
│   │   └── daily-puzzle-generation.json
│   └── bootstrap.js              # one-time backfill helper
├── README.md
└── .gitignore
```

**Repo hygiene:**
- `.gitignore` any local dev scripts that print puzzles to console.
- README should NOT include sample puzzle outputs from the generator.
- The Atlas App Services config files (triggers, function deployment definitions) can be checked in via Atlas's GitHub integration or `realm-cli` — this is the "Components as code" target.

---

## 9. Acceptance Criteria

The build is "done" when:

**Backend:**
1. Atlas Trigger fires daily at 00:05 UTC and inserts exactly one new puzzle document per day.
2. The generator function never logs puzzle contents; only success/failure and date.
3. The `getTodaysPuzzle` endpoint returns today's puzzle, never future or arbitrary dates.
4. The endpoint returns 503 with a friendly message if today's puzzle is missing.
5. Bootstrap script generated the launch-day puzzle.

**Frontend:**
6. Opening the app fetches today's puzzle from the API and caches it locally.
7. Subsequent reloads on the same day do not re-fetch.
8. Offline reload after a successful fetch still lets the player continue today's game.
9. Player can place ops via tap, drag, and keyboard.
10. Submitting a complete guess produces correct feedback per §3.1.
11. The numeric result of each guess is displayed in-game.
12. Win on any guess opens the end modal with a shareable grid that matches §7.1 exactly.
13. Loss after 6 guesses opens the end modal and reveals the solution.
14. Streak increments on win, resets on loss or missed day, persists across reloads.
15. Stats modal shows current/best streak and guess distribution.
16. Color-blind mode works.
17. Lighthouse a11y score ≥ 95.
18. No console errors. No external network requests after the daily puzzle fetch.

---

## 10. Stretch / V2 Ideas

Not in v1 scope. Listed so they're not lost.

- **Hard mode:** revealed greens must stay in their slot on subsequent guesses; revealed yellows must be used.
- **Archive:** play past puzzles (read-only, no streak credit).
- **Friend leagues:** paste a friend's share grid to compare guess counts.
- **Difficulty tiers:** Easy (3 ops, 5 in pool), Hard (6 ops, 9 in pool).
- **Duplicate ops in pool:** introduces Wordle-style counting in feedback algorithm.
- **Theme days:** Friday is all-division, Sunday is large-target, etc.

---

## 11. Open Questions for Implementer

These are intentional decisions to defer or revisit:

1. **Trigger time:** `00:05 UTC` is suggested. If you have a clear primary audience time zone (e.g., US Central where Jason lives), consider firing closer to local midnight there. Trade-off: fairness vs. convenience.
2. **Puzzle number rollover:** When `puzzleNumber` reaches a milestone (#100, #500), maybe celebrate in-app. Not required.
3. **Archive mode:** Currently no past-puzzle access. If you add it later, you'll want a `getPuzzleByNumber` endpoint with appropriate caching and rate limiting — but be intentional about whether unfinished players can fetch "today" as an archive entry tomorrow to verify their loss.
4. **Animations:** exact timings are tunable; the spec gives ballpark numbers.
5. **Confetti on win:** implementer's discretion on whether to include a library or write a small canvas effect.
6. **Failover if trigger misses a day:** Atlas triggers are reliable but not 100%. If a day is missed, the API returns 503 and players can't play. Consider an on-demand fallback: if `getTodaysPuzzle` finds nothing, it could call `generatePuzzle` directly. The downside is that the developer's first call of the day would technically reveal it. Probably accept the 503 risk in v1 and monitor.

---

## Appendix A: Worked generation example

This is what runs inside the Atlas `generatePuzzle` function at 00:05 UTC each day. Random bytes are drawn fresh; no seed is recorded.

```
Step 1: start = randInt(5, 20) → 10
Step 2: build solution
  current = 10
  pick from legal ops (those yielding positive integer):
    ×2 → 20
    +3 → 23
    ×3 → 69
    −2 → 67
    +6 → 73
  solution = [×2, +3, ×3, −2, +6]
  target = 73 ∈ [20, 250] ✓
  has × and + ✓

Step 3: decoys
  pick ÷5 (distinct from solution ops) ✓
  pick −1 (distinct) ✓
  pool = [×2, +3, ×3, −2, +6, ÷5, −1]

Step 4: uniqueness
  brute-force 2520 orderings
  exactly 1 hits 73 → ✓ unique

Step 5: persist
  upsert into MongoDB with _id = "2026-05-23", puzzleNumber = 142
  return success (do NOT log puzzle contents)
```

---

*End of spec. Ship it.*