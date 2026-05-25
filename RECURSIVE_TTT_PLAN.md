# Recursive TTT + Game Hub — Implementation Plan

## Overview

Add **Ultimate Tic-Tac-Toe** (recursive, any depth, multiplayer) to Reckon and convert the homepage into a game hub. Ultimate TTT uses the "sending" mechanic: your cell placement forces the opponent to play in the correspondingly-numbered mini-board next turn. To "claim" a macro cell you must win the mini-board inside it.

---

## Game Rules (Ultimate Tic-Tac-Toe)

- **Depth 2** (canonical): a 3×3 grid of 3×3 mini-boards (81 cells total).
- A **move** is `[boardIdx, cellIdx]`. Playing in cell `c` of any board sends the opponent to mini-board `c`.
- If the target mini-board is already won or full, the opponent may play in **any** unclaimed board.
- Win a mini-board by getting 3-in-a-row. Win the macro game by claiming 3 mini-boards in a row.
- **Depth 3+**: same rules recurse. Move is `[i0, i1, …, i_{depth-1}]`. After move `M`, next constraint = `M[1:]` (drop outer index, keep inner indices).
- Constraint shortens if any node along the path is already resolved.

---

## Architecture

```
reckon/
├── api/
│   ├── generate.js          (unchanged)
│   ├── today.js             (unchanged)
│   └── ttt.js               ← NEW unified TTT endpoint
├── public/
│   ├── index.html           ← modified (hub + TTT views added)
│   ├── styles.css           ← modified (hub cards, TTT board)
│   ├── app.js               ← modified (hash router, lazy-init Reckon)
│   └── ttt.js               ← NEW TTT game logic + rendering
└── vercel.json              (unchanged)
```

### Routing (Hash-based SPA)

| Hash | View shown | Notes |
|------|-----------|-------|
| `#/` or empty | Hub | Two game cards |
| `#/reckon` | Reckon game | Existing game, lazy-init |
| `#/ttt/new` | TTT setup | Choose depth, create game |
| `#/ttt/:id` | TTT game | Auto-join if O slot open |

---

## Data Model

### Game Object (stored in Vercel Blob)

```json
{
  "id": "abc12345",
  "depth": 2,
  "board": { "<recursive board — see below>" },
  "currentPlayer": "X",
  "constraint": [],
  "players": {
    "X": { "token": "<16-char random>", "joinedAt": 1234567890 },
    "O": null
  },
  "status": "waiting | playing | X_won | O_won | draw",
  "createdAt": 1234567890,
  "lastMoveAt": 1234567890
}
```

### Recursive Board (depth 1 — leaf)

```json
{ "depth": 1, "cells": [null, null, null, null, null, null, null, null, null], "winner": null }
```

### Recursive Board (depth N — branch)

```json
{ "depth": N, "subBoards": [ "<9× board of depth N-1>" ], "winner": null }
```

`winner` values: `null` (in progress), `"X"`, `"O"`, `"draw"`.

### Constraint Array

- Length `0` → free to play anywhere
- Length `1` → must play in top-level board `constraint[0]`
- Length `d-1` → full constraint (one per depth level, last index free)

After a move `[i0, i1, …, i_{d-1}]`, the next constraint starts as `[i1, …, i_{d-1}]`. Then walk that path; if any node along it is resolved (winner ≠ null), truncate the array at that point.

---

## Blob Storage Strategy

- **Key pattern**: `ttt/{gameId}/state.json` with `addRandomSuffix: true` (Vercel Blob generates a unique URL per write, avoiding CDN stale-cache issues)
- **Save**: `put()` new blob first, then `list()` and `del()` all older blobs for that game ID
- **Load**: `list({ prefix: 'ttt/{gameId}/' })`, sort by `uploadedAt` descending, fetch the first result
- Race condition: acceptable for turn-based game since only the current player can write (server validates `currentPlayer`)

---

## API — `api/ttt.js`

Single file, dispatches on method + `action` body field.

### `GET /api/ttt?id={gameId}`
Returns sanitized game state (tokens stripped out). Used by both players to poll for updates.

**Response** (200):
```json
{
  "id": "abc12345",
  "depth": 2,
  "board": { "..." },
  "currentPlayer": "X",
  "constraint": [],
  "players": { "X": { "joinedAt": 0 }, "O": null },
  "status": "waiting",
  "createdAt": 0,
  "lastMoveAt": 0
}
```

### `POST /api/ttt` — `action: "create"`
**Body**: `{ "action": "create", "depth": 2 }`  
**Creates**: empty board, `gameId` (8-char base64url), X player token (16-char), status=`waiting`  
**Response**: `{ "gameId": "abc12345", "playerToken": "xxx", "role": "X" }`

### `POST /api/ttt` — `action: "join"`
**Body**: `{ "action": "join", "gameId": "abc12345" }`  
**Creates**: O player token, sets status=`playing`  
**Errors**: 404 if not found, 409 if already full  
**Response**: `{ "gameId": "abc12345", "playerToken": "yyy", "role": "O" }`

### `POST /api/ttt` — `action: "move"`
**Body**: `{ "action": "move", "gameId": "abc12345", "playerToken": "xxx", "move": [4, 2] }`  
**Validates**:
1. Game status is `playing`
2. Token matches `currentPlayer`
3. `move.length === depth`
4. Move satisfies constraint (move starts with constraint indices)
5. Target board path is all unresolved
6. Target cell is null

**Applies**:
1. Place player symbol in cell
2. Walk up, recalculate `winner` at each board level
3. Compute new constraint via `resolveConstraint(board, move.slice(1))`
4. Update `status` if game over; else flip `currentPlayer`

**Response**: `{ "ok": true, "game": { "<sanitized state>" } }`

### Shared board utilities (in `api/ttt.js`)

```js
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function createBoard(depth) { ... }          // recursive empty board
function applyMove(board, player, move) { ... } // mutates board, recalcs winner
function checkBoardWinner(board) { ... }     // returns 'X'|'O'|'draw'|null
function resolveConstraint(board, path) { ... } // trims path where boards are resolved
function isValidMove(board, constraint, move) { ... }
```

---

## Frontend — `public/ttt.js`

### State

```js
let tttState = {
  game: null,        // sanitized game object from server
  myToken: null,     // from localStorage
  myRole: null,      // 'X' | 'O' | null (observer)
  gameId: null,
  pollTimer: null,
  focusPath: [],     // depth-3+ zoom: which outer board we're viewing
};
```

### LocalStorage

Key: `reckon:ttt:{gameId}` → `{ token, role }`

### API calls

```js
async function tttCreate(depth)             // POST create → navigate to #/ttt/{id}
async function tttEnterGame(id)             // GET state, auto-join if waiting+no-O
async function tttMakeMove(movePath)        // POST move → update state + re-render
async function tttPoll()                    // GET state every 2s if opponent's turn
function tttStopPoll()                      // clearInterval(pollTimer)
```

`tttEnterGame` logic:
1. Load saved token from localStorage for this gameId (if any)
2. GET game state
3. If `status=waiting` and `players.O=null` and no saved token → POST join → save token
4. If already have a saved token → just observe/play
5. Start poll if game is `playing` and it's opponent's turn

### Rendering

```js
function tttRenderAll()                     // top-level: status + board
function tttRenderStatus()                  // turn indicator / waiting / winner
function tttRenderBoard()                   // dispatches depth-2 vs depth-3+
function renderOuterBoard(board, constraint)        // depth 2 full render
function renderSubBoard(sub, outerIdx, constraint)  // one mini-board
function renderDeepBoard(board, constraint)         // depth 3+ overview+zoom
function renderMacroOverview(board, constraint, focusPath) // compact 3×3 strip
```

### Depth-2 Full Render

```
<div class="ttt-outer-board">
  (for each of 9 sub-boards)
  <div class="ttt-sub-board [forced] [resolved] [won-X|won-O]">
    [if won: <div class="ttt-winner-overlay">X</div>]
    [else: 9× <button class="ttt-cell [playable]" data-move="4,2">]
  </div>
</div>
```

- `forced` class: sub-board index matches `constraint[0]` (or all boards when constraint empty)
- `resolved` class: sub-board has a winner
- `ttt-cell.playable`: it's the local player's turn AND the move is valid
- Click a `.playable` cell → calls `tttMakeMove([outerIdx, cellIdx])`

### Depth-3+ Zoom Render

Two panels:

**Panel 1 — Macro Overview Strip** (compact 3×3 at ~200px wide):
```
<div class="ttt-macro-overview">
  9× <div class="ttt-macro-cell [won-X|won-O|active-focus|forced-outer]"> X/O/· </div>
</div>
```
Clicking an unclaimed macro cell (when free) sets `tttState.focusPath = [idx]` and re-renders.

**Panel 2 — Focused Sub-Board** (full depth-2 render):
```
<div class="ttt-focus-board">
  <div class="ttt-focus-label">Board 4</div>
  <!-- full depth-2 render of board.subBoards[focusPath[0]] -->
  <!-- constraint passed down is constraint.slice(1) -->
</div>
```

When constraint is `[a, b]`: `focusPath` is locked to `[a]`, inner constraint passed to depth-2 renderer is `[b]`.  
When constraint is `[a]`: `focusPath` locked to `[a]`, inner constraint is `[]` (free within).  
When constraint is `[]`: player picks macro cell first, then plays freely in it.

Depth-4+: add a second overview strip for the mid-level. Same pattern extends naturally.

### Move click flow by depth/constraint

| Depth | Constraint | Player action |
|-------|-----------|--------------|
| 2 | `[]` | Click any cell → move `[board, cell]` |
| 2 | `[b]` | Click cell in board b → move `[b, cell]` |
| 3 | `[]` | Click macro overview → sets focus; click cell → move `[focus, mid, cell]` |
| 3 | `[a]` | Focus locked to a; click cell → move `[a, mid, cell]` |
| 3 | `[a,b]` | Focus locked to a, mini-board b forced; click cell → move `[a, b, cell]` |

---

## Frontend — `public/index.html` additions

```html
<!-- NEW: Hub view -->
<div id="view-hub" class="view">
  <div class="hub-tagline">Choose a game</div>
  <div class="hub-cards">
    <a class="game-card" href="#/reckon">
      <div class="game-card-icon">🔢</div>
      <h2 class="game-card-title">Reckon</h2>
      <p class="game-card-desc">Daily math puzzle</p>
      <span class="game-card-badge">Daily</span>
    </a>
    <a class="game-card" href="#/ttt/new">
      <div class="game-card-icon">⊞</div>
      <h2 class="game-card-title">Ultimate TTT</h2>
      <p class="game-card-desc">Recursive tic-tac-toe</p>
      <span class="game-card-badge">Multiplayer</span>
    </a>
  </div>
</div>

<!-- NEW: TTT Setup view -->
<div id="view-ttt-setup" class="view hidden">
  <h2 class="section-title">New Game</h2>
  <div class="depth-picker">
    <label class="depth-option"><input type="radio" name="depth" value="2" checked> <strong>Depth 2</strong> — 9 mini-boards (classic)</label>
    <label class="depth-option"><input type="radio" name="depth" value="3"> <strong>Depth 3</strong> — 9×9 boards (long game)</label>
    <label class="depth-option"><input type="radio" name="depth" value="4"> <strong>Depth 4</strong> — expert only</label>
  </div>
  <button id="ttt-create-btn" class="btn-primary">Create Game →</button>
</div>

<!-- NEW: TTT Game view -->
<div id="view-ttt-game" class="view hidden">
  <div id="ttt-status-bar" class="ttt-status"></div>
  <div id="ttt-invite-bar" class="ttt-invite hidden">
    <p class="ttt-invite-label">Share this link to invite your opponent:</p>
    <div class="ttt-invite-row">
      <input id="ttt-invite-link" class="ttt-invite-input" readonly>
      <button id="ttt-copy-link" class="btn-secondary">Copy</button>
    </div>
  </div>
  <div id="ttt-board-container"></div>
  <div id="ttt-game-over" class="ttt-game-over hidden">
    <p id="ttt-game-over-msg"></p>
    <button id="ttt-play-again-btn" class="btn-primary">Play Again</button>
  </div>
</div>
```

Existing `<main>` contents (game-ui, puzzle-preparing, connection-error) wrap in `<div id="view-reckon" class="view hidden">`.

Header modification — add back button on the left:
```html
<header>
  <div class="header-left">
    <button id="back-btn" class="header-icon-btn hidden" aria-label="Back to hub">←</button>
  </div>
  <h1>RECKON</h1>
  <div class="header-right">
    <button id="streak-btn" …>…</button>
    <button id="settings-btn" …>…</button>
  </div>
</header>
```

---

## Frontend — `public/app.js` modifications

### Router (new, added near top)

```js
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${name}`)?.classList.remove('hidden');

  // Header context
  const onHub    = name === 'hub';
  const onReckon = name === 'reckon';
  const onTTT    = name === 'ttt-setup' || name === 'ttt-game';

  document.getElementById('back-btn')?.classList.toggle('hidden', onHub);
  document.getElementById('streak-btn')?.classList.toggle('hidden', !onReckon);
  document.getElementById('settings-btn')?.classList.toggle('hidden', !onReckon);
}

function route() {
  const hash = location.hash || '#/';
  closeAllModals?.();
  tttStopPoll?.();

  if (hash === '#/' || hash === '#') {
    showView('hub');
  } else if (hash === '#/reckon') {
    showView('reckon');
    if (!puzzle) initReckon();   // lazy-init: only fetch puzzle when entering Reckon
  } else if (hash === '#/ttt/new') {
    showView('ttt-setup');
  } else if (hash.startsWith('#/ttt/')) {
    const id = hash.slice(6);
    if (id) { showView('ttt-game'); tttEnterGame(id); }
    else location.hash = '#/ttt/new';
  } else {
    location.hash = '#/';
  }
}

window.addEventListener('hashchange', route);
// Replace existing DOMContentLoaded handler:
document.addEventListener('DOMContentLoaded', () => {
  setupStaticListeners(); // modals, settings toggles, keyboard
  route();
});
```

### Existing init() refactor

Split into:
- `initReckon()` — the existing async function body (loads puzzle, renders board, etc.), only called when entering `#/reckon`
- `setupStaticListeners()` — event listeners that apply globally (modal close, escape key, settings toggles, back button → `location.hash = '#/'`)

### Back button listener

```js
document.getElementById('back-btn')?.addEventListener('click', () => {
  location.hash = '#/';
});
```

---

## CSS additions — `public/styles.css`

### View system

```css
.view { width: 100%; }
.view.hidden { display: none !important; }
```

### Hub

```css
.hub-tagline {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 16px 0 8px;
}

.hub-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 8px 0 24px;
  width: 100%;
}

@media (max-width: 320px) {
  .hub-cards { grid-template-columns: 1fr; }
}

.game-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 12px;
  border: 2px solid var(--border);
  border-radius: 16px;
  text-decoration: none;
  color: var(--text);
  background: var(--surface);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
  position: relative;
}

.game-card:hover {
  transform: translateY(-3px);
  border-color: var(--color-green);
  box-shadow: 0 6px 20px rgba(0,0,0,0.10);
}

.game-card-icon { font-size: 2.2rem; line-height: 1; }
.game-card-title { font-size: 1rem; font-weight: 700; letter-spacing: 0.05em; }
.game-card-desc { font-size: 0.75rem; color: var(--text-muted); text-align: center; }

.game-card-badge {
  position: absolute;
  top: 10px; right: 10px;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--text-muted);
}
```

### Header back button

```css
.header-icon-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text); font-size: 1.1rem;
  padding: 8px; min-width: 44px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
}
.header-icon-btn:hover { background: var(--bg-secondary); }
```

### TTT Setup

```css
.section-title {
  font-size: 1.1rem; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; text-align: center;
  padding: 16px 0 12px;
}

.depth-picker {
  display: flex; flex-direction: column; gap: 10px;
  padding: 8px 0 20px;
}

.depth-option {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  border: 2px solid var(--border); border-radius: 10px;
  cursor: pointer; font-size: 0.9rem; line-height: 1.4;
}

.depth-option:has(input:checked) { border-color: var(--color-green); }
.depth-option input { margin-top: 2px; accent-color: var(--color-green); }
```

### TTT Status bar

```css
.ttt-status {
  text-align: center; padding: 10px 0 6px;
  font-size: 1rem; font-weight: 600; min-height: 40px;
}

.ttt-status .sym-X { color: var(--color-green); font-weight: 800; }
.ttt-status .sym-O { color: var(--color-yellow); font-weight: 800; }
```

### TTT Invite bar

```css
.ttt-invite {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
}
.ttt-invite-label { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; }
.ttt-invite-row { display: flex; gap: 8px; }
.ttt-invite-input {
  flex: 1; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg); color: var(--text);
  font-size: 0.8rem;
}
.btn-secondary {
  padding: 8px 16px;
  background: var(--bg); border: 2px solid var(--border);
  border-radius: 6px; font-size: 0.85rem; font-weight: 700;
  cursor: pointer; color: var(--text);
  transition: border-color 0.15s;
}
.btn-secondary:hover { border-color: var(--color-green); }
```

### TTT Depth-2 Board

```css
.ttt-outer-board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  width: 100%;
  max-width: 460px;
  /* Thick lines between 3x3 macro sections — use box-shadow trick */
}

.ttt-sub-board {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 4px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  transition: border-color 0.2s;
}

.ttt-sub-board.forced {
  border-color: var(--color-green);
  border-width: 3px;
  background: color-mix(in srgb, var(--color-green) 8%, var(--bg-secondary));
}

.ttt-sub-board.resolved {
  opacity: 0.45;
}

.ttt-sub-board.won-X { border-color: var(--color-green); }
.ttt-sub-board.won-O { border-color: var(--color-yellow); }

.ttt-winner-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(1.8rem, 6vw, 2.8rem);
  font-weight: 900;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  z-index: 1;
}

.ttt-winner-overlay.X { color: var(--color-green); }
.ttt-winner-overlay.O { color: var(--color-yellow); }
.ttt-winner-overlay.draw { color: var(--text-muted); font-size: 1.4rem; }

.ttt-cell {
  aspect-ratio: 1;
  min-height: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--tile-border);
  border-radius: 4px;
  font-size: clamp(0.65rem, 2.5vw, 1rem);
  font-weight: 900;
  background: var(--tile-empty-bg);
  color: var(--text);
  cursor: default;
  transition: background 0.1s;
  padding: 0;
}

.ttt-cell[data-val="X"] { color: var(--color-green); }
.ttt-cell[data-val="O"] { color: var(--color-yellow); }

.ttt-cell.playable {
  cursor: pointer;
  background: var(--bg);
}

.ttt-cell.playable:hover {
  background: var(--tile-filled-bg);
  border-color: var(--tile-border-active);
}

.ttt-cell:disabled { cursor: default; }
```

### TTT Depth-3+ Macro Overview

```css
.ttt-deep-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.ttt-macro-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: 100%;
  max-width: 220px;
}

.ttt-macro-cell {
  aspect-ratio: 1;
  border: 2px solid var(--border);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; font-weight: 800;
  cursor: default;
  transition: border-color 0.15s, background 0.15s;
}

.ttt-macro-cell.selectable { cursor: pointer; }
.ttt-macro-cell.selectable:hover { border-color: var(--tile-border-active); }
.ttt-macro-cell.active-focus { border-color: var(--color-green); border-width: 3px; }
.ttt-macro-cell.forced-outer { border-color: var(--color-green); border-width: 3px; }
.ttt-macro-cell.won-X { background: var(--color-green); color: #fff; border-color: var(--color-green); }
.ttt-macro-cell.won-O { background: var(--color-yellow); color: #fff; border-color: var(--color-yellow); }
.ttt-macro-cell.draw { background: var(--color-gray); color: #fff; border-color: var(--color-gray); }

.ttt-focus-panel {
  width: 100%;
}

.ttt-focus-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
  text-align: center;
}
```

### TTT Game-over panel

```css
.ttt-game-over {
  text-align: center;
  padding: 16px 0;
}

.ttt-game-over p {
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 16px;
}
```

---

## Key Implementation Notes

### `resolveConstraint` logic

```js
function resolveConstraint(board, path) {
  // Walk `path` into the board tree.
  // If we hit a resolved node, truncate the path there.
  let node = board;
  for (let i = 0; i < path.length; i++) {
    const child = node.subBoards?.[path[i]];
    if (!child || child.winner !== null) {
      return path.slice(0, i);  // free from this level
    }
    node = child;
  }
  return path; // full constraint valid
}
```

### `isValidMove` logic

```js
function isValidMove(board, constraint, move) {
  if (move.length !== board.depth) return false;

  // Must satisfy constraint prefix
  for (let i = 0; i < constraint.length; i++) {
    if (move[i] !== constraint[i]) return false;
  }

  // Walk to the depth-1 board
  let node = board;
  for (let i = 0; i < move.length - 1; i++) {
    const sub = node.subBoards?.[move[i]];
    if (!sub || sub.winner !== null) return false;
    node = sub;
  }

  // Check cell is empty
  if (node.depth !== 1 || node.winner !== null) return false;
  return node.cells[move[move.length - 1]] === null;
}
```

### `applyMove` logic

```js
function applyMove(board, player, move) {
  if (move.length === 1) {
    board.cells[move[0]] = player;
  } else {
    applyMove(board.subBoards[move[0]], player, move.slice(1));
  }
  board.winner = checkBoardWinner(board);
  return board;
}
```

### Polling strategy

- Poll every **2 000 ms** while:
  - `game.status === 'playing'`
  - `game.currentPlayer !== myRole` (it's the opponent's turn)
- Stop polling when:
  - Status becomes terminal (`X_won`, `O_won`, `draw`)
  - It becomes the local player's turn (they need to act, not poll)
  - The view changes (route away from TTT game)
- Restart poll after each successful move (in case opponent moves quickly)

### Token persistence

```js
// Save on create/join:
localStorage.setItem(`reckon:ttt:${gameId}`, JSON.stringify({ token, role }));

// Load on entering game:
const saved = JSON.parse(localStorage.getItem(`reckon:ttt:${gameId}`) || 'null');
if (saved) { myToken = saved.token; myRole = saved.role; }
```

### "Free to play anywhere" visual (depth 2)

When `constraint = []`, ALL mini-boards that aren't resolved should show as playable. Don't apply the `forced` class to any specific board — instead every valid cell in every unresolved board is `.playable`.

### Depth-3 free constraint (no forced board)

When `constraint = []` and `depth = 3`:
- Show macro overview with all unclaimed boards as `.selectable`
- `tttState.focusPath = []` (no board focused)
- Clicking a macro cell sets `tttState.focusPath = [idx]` and re-renders
- Now depth-2 board for `focusPath[0]` is shown; all its cells are playable (mini-board free within it)
- Clicking a cell triggers move `[focusPath[0], midIdx, cellIdx]`
- Reset `focusPath = []` after move

---

## Verification Checklist

1. **Hub loads** at `/` — two game cards visible, hover effect works
2. **Reckon** — navigate `#/reckon`, existing puzzle loads and plays correctly; back button returns to hub
3. **TTT create** — `#/ttt/new` → pick depth 2 → Create → redirects to `#/ttt/{id}`, invite link shown
4. **TTT join** — copy invite link, open second browser tab → auto-joins as O, invite bar hides
5. **Multiplayer sync** — X makes a move, O's tab shows update within ~2 s
6. **Constraint sending** — after X plays in cell 4 of any board, board 4 gets `forced` highlight for O
7. **Constraint relaxation** — force a mini-board to be won; verify opponent can then play anywhere
8. **Win detection** — engineer a win on a mini-board, verify macro cell shows X/O overlay; win 3 in a row on macro board, verify game-over banner
9. **Draw** — fill all cells without a winner; verify `draw` status
10. **Depth 3 game** — create depth-3 game, verify overview panel + zoom panel appear; verify constraint sends correctly across levels
11. **Mobile (360 px)** — depth-2 board: cells are at least 40 px, tappable without zoom
12. **Dark mode + color-blind mode** — TTT board respects theme variables
13. **Blob cleanup** — after a few moves, verify old blobs are deleted (check Vercel Blob storage; no unbounded growth)
14. **Reconnect** — refresh page mid-game, verify token is recovered from localStorage and play resumes

---

## Out of Scope (future work)

- WebSocket / SSE real-time push (currently polling every 2 s)
- AI opponent
- Game history / replay
- Rematch with same players (currently "Play Again" creates a fresh game)
- Chat / emoji reactions
- ELO / leaderboard
