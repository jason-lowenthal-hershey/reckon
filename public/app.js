/**
 * Reckon — app.js
 * Vanilla JS SPA, no build step, runs on DOMContentLoaded.
 */

'use strict';

// ── Constants ───────────────────────────────────────────────────────────────

const API_URL        = '/api/today';
const STORAGE_STATE  = 'reckon:state';
const STORAGE_PUZZLE = 'reckon:puzzle';
const LAUNCH_DATE    = '2026-05-23';
const MAX_GUESSES    = 6;
const OPS_PER_GUESS  = 5;
const FP_TOLERANCE   = 1e-9;

const OP_DISPLAY = { '+': '+', '-': '−', '*': '×', '/': '÷' };

const FEEDBACK_EMOJI = { G: '🟩', Y: '🟨', W: '⬜' };

// ── State ────────────────────────────────────────────────────────────────────

let puzzle       = null;   // loaded from API / cache
let gameState    = null;   // loaded from localStorage
let currentGuess = [];     // ops placed in the current row
let isAnimating  = false;
let countdownInterval = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns 'YYYY-MM-DD' in UTC. */
function getUTCDate() {
  return new Date().toISOString().split('T')[0];
}

/** Returns a display string like '×2' or '−3'. */
function formatOp(op) {
  return (OP_DISPLAY[op.operator] || op.operator) + op.operand;
}

/** Returns a stable string key for an op, e.g. '*2'. */
function opKey(op) {
  return `${op.operator}${op.operand}`;
}

/** True if two ops are equal (same operator AND operand). */
function opEquals(a, b) {
  return a.operator === b.operator && a.operand === b.operand;
}

/** Apply a single op to a value. */
function applyOp(value, op) {
  switch (op.operator) {
    case '+': return value + op.operand;
    case '-': return value - op.operand;
    case '*': return value * op.operand;
    case '/': return value / op.operand;
    default:  return value;
  }
}

/** Apply a sequence of ops to a start value. */
function applyAll(start, ops) {
  return ops.reduce((v, op) => applyOp(v, op), start);
}

/**
 * Score a guess against the solution.
 * Returns an array of 'G' | 'Y' | 'W' for each slot.
 * Assumes all ops in the pool are distinct, so no duplicate handling needed.
 */
function scoreGuess(guess, solution) {
  const solutionSet = new Set(solution.map(opKey));
  return guess.map((op, i) => {
    if (opEquals(op, solution[i])) return 'G';
    if (solutionSet.has(opKey(op)))  return 'Y';
    return 'W';
  });
}

/** Days since the launch date (launch = day 1). */
function daysSinceLaunch(dateStr) {
  const launch = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const target  = new Date(dateStr    + 'T00:00:00Z');
  const diff    = Math.round((target - launch) / 86_400_000);
  return diff + 1; // launch is day 1
}

/** Sleeps for ms milliseconds, returning a Promise. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if reduced-motion is preferred. */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── State persistence ────────────────────────────────────────────────────────

function getDefaultState() {
  return {
    version: 1,
    streak: {
      current:     0,
      best:        0,
      lastWinDate: null,
    },
    today: null,
    history: [],
    settings: {
      colorBlindMode: false,
      darkMode:       false,
    },
    seenOnboarding: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_STATE);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    // Basic validation
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return getDefaultState();
    }
    // Ensure nested objects exist
    parsed.streak   = parsed.streak   || { current: 0, best: 0, lastWinDate: null };
    parsed.settings = parsed.settings || { colorBlindMode: false, darkMode: false };
    parsed.history  = Array.isArray(parsed.history) ? parsed.history : [];
    return parsed;
  } catch {
    return getDefaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_STATE, JSON.stringify(gameState));
  } catch {
    // Silently fail if storage is unavailable
  }
}

/**
 * Daily reset logic:
 *   1. If today.date !== UTC today → archive old today, clear today
 *   2. If streak.lastWinDate is more than 1 day before today → reset streak.current
 *   3. Initialise today if not present
 */
function doDailyReset() {
  const today = getUTCDate();

  // Archive stale "today" entry
  if (gameState.today && gameState.today.date !== today) {
    // Only archive if there was meaningful activity (guesses made)
    if (gameState.today.guesses && gameState.today.guesses.length > 0) {
      gameState.history.unshift({
        date:       gameState.today.date,
        status:     gameState.today.status,
        guessCount: gameState.today.guesses.length,
      });
      // Cap history at 30 entries
      if (gameState.history.length > 30) {
        gameState.history = gameState.history.slice(0, 30);
      }
    }
    gameState.today = null;
  }

  // Check streak validity
  if (gameState.streak.lastWinDate) {
    const lastWin   = new Date(gameState.streak.lastWinDate + 'T00:00:00Z');
    const todayDate = new Date(today                        + 'T00:00:00Z');
    const daysDiff  = Math.round((todayDate - lastWin) / 86_400_000);
    if (daysDiff > 1) {
      gameState.streak.current = 0;
    }
  }

  // Initialise today
  if (!gameState.today) {
    gameState.today = {
      date:    today,
      guesses: [],
      status:  'in_progress',
    };
  }

  saveState();
}

// ── Puzzle loading ───────────────────────────────────────────────────────────

async function loadPuzzle() {
  const today = getUTCDate();

  // 1. Check cache
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_PUZZLE) || 'null');
    if (cached && cached.date === today && cached.puzzle) {
      puzzle = cached.puzzle;
      return;
    }
  } catch {
    // Bad cache — ignore, will fetch fresh
  }

  // 2. Fetch from API
  try {
    const res = await fetch(API_URL);

    if (res.status === 503) {
      showEl('puzzle-preparing');
      return;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    puzzle = data;

    // Cache it
    try {
      localStorage.setItem(STORAGE_PUZZLE, JSON.stringify({ date: today, puzzle: data }));
    } catch {
      // Storage full — non-fatal
    }
  } catch {
    // Network error fallback
    try {
      const stale = JSON.parse(localStorage.getItem(STORAGE_PUZZLE) || 'null');
      if (stale && stale.puzzle) {
        puzzle = stale.puzzle;
        showToast('Playing offline with a recent puzzle…');
        return;
      }
    } catch {
      // No usable cache
    }
    showEl('connection-error');
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}


function showToast(msg, durationMs = 2000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), durationMs);
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Full render: board + pool + submit. */
function render() {
  if (!puzzle || !gameState) return;

  document.getElementById('start-number').textContent  = puzzle.start;
  document.getElementById('target-number').textContent = puzzle.target;

  renderBoard();
  renderPool();
  updateSubmitBtn();
}

/**
 * Determines the CSS color class name for a feedback code,
 * respecting color-blind mode.
 */
function colorClass(code) {
  const cb = document.documentElement.classList.contains('color-blind');
  if (code === 'G') return cb ? 'blue-cb' : 'green';
  if (code === 'Y') return cb ? 'orange-cb' : 'yellow';
  return 'gray';
}

/**
 * Returns the cb-icon character for a feedback code.
 * Only visible when color-blind mode is on (controlled by CSS).
 */
function cbIconChar(code) {
  if (code === 'G') return '✓';
  if (code === 'Y') return '↺';
  return '✗';
}

/** Build a single tile element. */
function makeTile(text, classes = [], clickHandler = null, ariaLabel = null) {
  const tile = document.createElement('button');
  tile.type = 'button';
  // Deduplicate: makeTile always adds 'tile'; callers should pass only modifiers
  const mods = classes.filter(c => c && c !== 'tile');
  tile.className = mods.length ? 'tile ' + mods.join(' ') : 'tile';
  tile.textContent = text;
  if (ariaLabel) tile.setAttribute('aria-label', ariaLabel);
  if (clickHandler) {
    tile.addEventListener('click', clickHandler);
  } else {
    tile.setAttribute('tabindex', '-1');
    tile.setAttribute('aria-disabled', 'true');
  }
  return tile;
}

/** Render the full board (6 rows). */
function renderBoard() {
  const board    = document.getElementById('board');
  const guesses  = gameState.today.guesses;
  const status   = gameState.today.status;
  const solution = puzzle.solution;

  board.innerHTML = '';

  for (let rowIdx = 0; rowIdx < MAX_GUESSES; rowIdx++) {
    const row       = document.createElement('div');
    row.className   = 'board-row';
    row.setAttribute('role', 'row');

    const tilesDiv  = document.createElement('div');
    tilesDiv.className = 'tiles';

    const resultDiv = document.createElement('div');
    resultDiv.className = 'row-result';

    if (rowIdx < guesses.length) {
      // ── Past row ──
      const guess = guesses[rowIdx];
      for (let i = 0; i < OPS_PER_GUESS; i++) {
        const code = guess.feedback[i];
        const cls  = colorClass(code);
        const op   = guess.ops[i];
        const label = `${formatOp(op)}, ${cls === 'green' || cls === 'blue-cb' ? 'correct position' : cls === 'yellow' || cls === 'orange-cb' ? 'in solution, wrong spot' : 'not in solution'}`;
        const tile = makeTile(formatOp(op), ['tile', cls], null, label);
        // Add cb-icon span
        const icon = document.createElement('span');
        icon.className   = 'cb-icon';
        icon.textContent = cbIconChar(code);
        icon.setAttribute('aria-hidden', 'true');
        tile.appendChild(icon);
        tilesDiv.appendChild(tile);
      }
      // Show numeric result
      const resultVal = Math.round(guess.result * 1e6) / 1e6; // clean up fp noise for display
      resultDiv.textContent = '= ' + resultVal;
    } else if (rowIdx === guesses.length && status === 'in_progress') {
      // ── Current (active) row ──
      row.classList.add('current');
      for (let i = 0; i < OPS_PER_GUESS; i++) {
        if (i < currentGuess.length) {
          const op    = currentGuess[i];
          const label = `${formatOp(op)}, slot ${i + 1}, tap to remove`;
          const tile  = makeTile(formatOp(op), ['tile', 'filled'], () => onSlotClick(i), label);
          tilesDiv.appendChild(tile);
        } else {
          const tile = document.createElement('div');
          tile.className = 'tile empty';
          tile.setAttribute('aria-label', `Empty slot ${i + 1}`);
          tile.setAttribute('role', 'gridcell');
          tilesDiv.appendChild(tile);
        }
      }
    } else {
      // ── Future row ──
      for (let i = 0; i < OPS_PER_GUESS; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile empty';
        tile.setAttribute('aria-label', `Empty slot ${i + 1}`);
        tile.setAttribute('role', 'gridcell');
        tilesDiv.appendChild(tile);
      }
    }

    row.appendChild(tilesDiv);
    row.appendChild(resultDiv);
    board.appendChild(row);
  }

  // ── Solution row on loss ──
  if (status === 'lost') {
    const solRow     = document.createElement('div');
    solRow.className = 'board-row solution-row';
    solRow.setAttribute('role', 'row');
    solRow.setAttribute('aria-label', 'Solution');

    const tilesDiv   = document.createElement('div');
    tilesDiv.className = 'tiles';

    const solResult  = applyAll(puzzle.start, solution);
    for (let i = 0; i < solution.length; i++) {
      const op   = solution[i];
      const cls  = document.documentElement.classList.contains('color-blind') ? 'blue-cb' : 'green';
      const tile = makeTile(formatOp(op), ['tile', cls], null, `Solution: ${formatOp(op)}`);
      const icon = document.createElement('span');
      icon.className   = 'cb-icon';
      icon.textContent = '✓';
      icon.setAttribute('aria-hidden', 'true');
      tile.appendChild(icon);
      tilesDiv.appendChild(tile);
    }

    const resultDiv = document.createElement('div');
    resultDiv.className = 'row-result';
    resultDiv.textContent = '= ' + solResult;

    solRow.appendChild(tilesDiv);
    solRow.appendChild(resultDiv);
    board.appendChild(solRow);
  }
}

/** Efficient update of just the current active row tiles (no full re-render). */
function updateCurrentRow() {
  const board   = document.getElementById('board');
  const guesses = gameState.today.guesses;
  const status  = gameState.today.status;
  if (status !== 'in_progress') return;

  const rows    = board.querySelectorAll('.board-row');
  const currRow = rows[guesses.length];
  if (!currRow) return;

  const tilesDiv = currRow.querySelector('.tiles');
  if (!tilesDiv) return;

  const existingTiles = tilesDiv.querySelectorAll('.tile');
  for (let i = 0; i < OPS_PER_GUESS; i++) {
    const tile = existingTiles[i];
    if (!tile) continue;

    if (i < currentGuess.length) {
      const op = currentGuess[i];
      tile.className   = 'tile filled';
      tile.textContent = formatOp(op);
      tile.setAttribute('aria-label', `${formatOp(op)}, slot ${i + 1}, tap to remove`);
      // Re-attach click handler by replacing element
      const newTile = makeTile(formatOp(op), ['tile', 'filled'], () => onSlotClick(i),
        `${formatOp(op)}, slot ${i + 1}, tap to remove`);
      tilesDiv.replaceChild(newTile, tile);
    } else {
      const newTile = document.createElement('div');
      newTile.className = 'tile empty';
      newTile.setAttribute('aria-label', `Empty slot ${i + 1}`);
      newTile.setAttribute('role', 'gridcell');
      tilesDiv.replaceChild(newTile, tile);
    }
  }
}

/** Render pool tiles. */
function renderPool() {
  const container = document.getElementById('pool-tiles');
  container.innerHTML = '';

  if (!puzzle) return;

  const placedKeys = new Set(currentGuess.map(opKey));
  const isOver     = gameState.today.status !== 'in_progress';

  // Key hint: 1–9 for indices 0–8, 0 for index 9
  const keyHint = idx => idx < 9 ? String(idx + 1) : '0';

  puzzle.pool.forEach((op, idx) => {
    const isPlaced = placedKeys.has(opKey(op));
    const btn      = document.createElement('button');
    btn.type       = 'button';
    btn.className  = 'pool-tile' + (isPlaced ? ' placed' : '');
    btn.dataset.op  = op.operator;   // used by CSS for family colours
    btn.setAttribute('aria-label', `${formatOp(op)}, press ${keyHint(idx)} to place`);
    btn.setAttribute('data-idx', idx);

    if (isPlaced || isOver) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => onPoolTileClick(op, idx));
    }

    // Operator symbol (large) + operand (smaller) — two-line visual
    const sym = document.createElement('span');
    sym.className   = 'op-sym';
    sym.textContent = OP_DISPLAY[op.operator] || op.operator;
    sym.setAttribute('aria-hidden', 'true');

    const num = document.createElement('span');
    num.className   = 'op-num';
    num.textContent = op.operand;
    num.setAttribute('aria-hidden', 'true');

    // Keyboard shortcut hint badge
    const hint = document.createElement('span');
    hint.className   = 'key-hint';
    hint.textContent = keyHint(idx);
    hint.setAttribute('aria-hidden', 'true');

    btn.appendChild(sym);
    btn.appendChild(num);
    btn.appendChild(hint);
    container.appendChild(btn);
  });
}

/** Enable/disable submit button based on currentGuess length. */
function updateSubmitBtn() {
  const btn    = document.getElementById('submit-btn');
  const isOver = gameState.today.status !== 'in_progress';
  btn.disabled = currentGuess.length < OPS_PER_GUESS || isOver || isAnimating;
}

// ── Interaction handlers ─────────────────────────────────────────────────────

function onPoolTileClick(op) {
  if (isAnimating) return;
  if (gameState.today.status !== 'in_progress') return;
  if (currentGuess.length >= OPS_PER_GUESS) return;
  // Check not already placed
  if (currentGuess.some(o => opEquals(o, op))) return;

  currentGuess.push(op);
  updateCurrentRow();
  renderPool();
  updateSubmitBtn();
}

function onSlotClick(slotIndex) {
  if (isAnimating) return;
  if (gameState.today.status !== 'in_progress') return;
  if (slotIndex < 0 || slotIndex >= currentGuess.length) return;

  currentGuess.splice(slotIndex, 1);
  updateCurrentRow();
  renderPool();
  updateSubmitBtn();
}

async function onSubmit() {
  if (isAnimating) return;
  if (currentGuess.length < OPS_PER_GUESS) return;
  if (gameState.today.status !== 'in_progress') return;

  isAnimating = true;
  updateSubmitBtn();

  // Evaluate guess
  const result   = applyAll(puzzle.start, currentGuess);
  const feedback = scoreGuess(currentGuess, puzzle.solution);
  const won      = Math.abs(result - puzzle.target) < FP_TOLERANCE;

  // Record guess
  const guessRecord = {
    ops:      [...currentGuess],
    result,
    feedback,
  };
  gameState.today.guesses.push(guessRecord);

  // Animate reveal on the board row
  const board        = document.getElementById('board');
  const rows         = board.querySelectorAll('.board-row');
  const currRowIndex = gameState.today.guesses.length - 1;
  const currRow      = rows[currRowIndex];

  if (currRow) {
    const tiles = currRow.querySelectorAll('.tile');
    await animateReveal(Array.from(tiles), feedback, currentGuess);

    // Show numeric result
    const resultDiv = currRow.querySelector('.row-result');
    if (resultDiv) {
      const displayVal = Math.round(result * 1e6) / 1e6;
      resultDiv.textContent = '= ' + displayVal;
    }
  }

  // Check end conditions
  const lostNow = !won && gameState.today.guesses.length >= MAX_GUESSES;

  if (won) {
    gameState.today.status = 'won';
    updateStreak(true);
    saveState();
  } else if (lostNow) {
    gameState.today.status = 'lost';
    updateStreak(false);
    saveState();
  } else {
    saveState();
  }

  currentGuess = [];

  if (won || lostNow) {
    renderBoard();
    renderPool();
    updateSubmitBtn();
    isAnimating = false;
    await sleep(500);
    if (won) {
      celebrateWin();
      await sleep(1500);
    }
    showEndModal();
  } else {
    renderPool();
    updateSubmitBtn();
    isAnimating = false;
  }
}

/**
 * Animate tile reveal with flip effect — tiles flip in parallel with 100ms stagger.
 * If prefers-reduced-motion: apply classes immediately with no animation.
 */
async function animateReveal(tiles, feedback, ops) {
  const reduced  = prefersReducedMotion();
  const FLIP     = 250; // ms for each half-flip
  const STAGGER  = 100; // ms between each tile's start

  if (reduced) {
    tiles.forEach((tile, i) => {
      const cls = colorClass(feedback[i]);
      tile.className   = `tile ${cls}`;
      tile.textContent = formatOp(ops[i]);
      const icon = document.createElement('span');
      icon.className   = 'cb-icon';
      icon.textContent = cbIconChar(feedback[i]);
      icon.setAttribute('aria-hidden', 'true');
      tile.appendChild(icon);
    });
    return;
  }

  // Flip each tile independently so they can overlap (parallel with stagger)
  async function flipOne(tile, code, op, delay) {
    await sleep(delay);

    // First half: rotate to 90deg (face disappears)
    tile.classList.add('flipping');
    await sleep(FLIP);

    // Mid-point: swap content & color while hidden
    const cls        = colorClass(code);
    tile.className   = `tile ${cls} flipping`;
    tile.textContent = formatOp(op);
    const icon = document.createElement('span');
    icon.className   = 'cb-icon';
    icon.textContent = cbIconChar(code);
    icon.setAttribute('aria-hidden', 'true');
    tile.appendChild(icon);

    // Tiny settle so browser registers the className change
    await sleep(16);

    // Second half: rotate back to 0deg (face reappears with new color)
    tile.classList.remove('flipping');
    await sleep(FLIP);
  }

  // Launch all flips in parallel; Promise.all waits for the last tile to finish
  await Promise.all(tiles.map((tile, i) =>
    flipOne(tile, feedback[i], ops[i], i * STAGGER)
  ));
}

// ── Streak ───────────────────────────────────────────────────────────────────

function updateStreak(won) {
  const today   = getUTCDate();
  const streak  = gameState.streak;

  if (won) {
    const lastWin = streak.lastWinDate;
    if (lastWin) {
      const last     = new Date(lastWin + 'T00:00:00Z');
      const now      = new Date(today   + 'T00:00:00Z');
      const daysDiff = Math.round((now - last) / 86_400_000);
      if (daysDiff === 1) {
        streak.current += 1;
      } else {
        streak.current = 1;
      }
    } else {
      streak.current = 1;
    }
    streak.best        = Math.max(streak.best, streak.current);
    streak.lastWinDate = today;
  } else {
    streak.current = 0;
  }

  updateStreakBadge();
}

function updateStreakBadge() {
  const el = document.getElementById('streak-count');
  if (el) el.textContent = gameState.streak.current;
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function onKeydown(e) {
  // Don't intercept when typing in inputs or modals are open
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (document.querySelector('.modal:not(.hidden)')) return;

  if (isAnimating) return;
  if (!puzzle || gameState.today.status !== 'in_progress') return;

  const key = e.key;

  // Number keys 1–9 → pool indices 0–8; 0 → pool index 9
  const KEY_TO_IDX = { '1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'0':9 };
  if (key in KEY_TO_IDX) {
    const poolIndex = KEY_TO_IDX[key];
    if (poolIndex < puzzle.pool.length) {
      const op = puzzle.pool[poolIndex];
      if (!currentGuess.some(o => opEquals(o, op)) && currentGuess.length < OPS_PER_GUESS) {
        onPoolTileClick(op, poolIndex);
      }
    }
    return;
  }

  if (key === 'Backspace') {
    if (currentGuess.length > 0) {
      currentGuess.pop();
      updateCurrentRow();
      renderPool();
      updateSubmitBtn();
    }
    return;
  }

  if (key === 'Enter') {
    if (currentGuess.length === OPS_PER_GUESS) {
      onSubmit();
    }
  }
}

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(id) {
  closeAllModals();
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    // Focus first focusable element
    const focusable = modal.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (focusable) setTimeout(() => focusable.focus(), 50);
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  // Clear countdown timer if closing end modal
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function showOnboarding() {
  openModal('onboarding-modal');
}

function showStats() {
  populateStats();
  openModal('stats-modal');
}

function populateStats() {
  const { streak, today, history } = gameState;

  // Aggregate counts
  let played    = 0;
  let totalWins = 0;
  const dist    = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 };

  // Count from history
  history.forEach(entry => {
    played++;
    if (entry.status === 'won') {
      totalWins++;
      const bucket = entry.guessCount;
      if (bucket >= 1 && bucket <= 6) dist[bucket]++;
    } else if (entry.status === 'lost') {
      dist['X']++;
    }
  });

  // Include today if it's over
  if (today && today.status !== 'in_progress') {
    played++;
    if (today.status === 'won') {
      totalWins++;
      const bucket = today.guesses.length;
      if (bucket >= 1 && bucket <= 6) dist[bucket]++;
    } else if (today.status === 'lost') {
      dist['X']++;
    }
  }

  // Update stat numbers
  document.getElementById('stat-played').textContent        = played;
  document.getElementById('stat-total-wins').textContent    = totalWins;
  document.getElementById('stat-current-streak').textContent = streak.current;
  document.getElementById('stat-best-streak').textContent   = streak.best;

  // Guess distribution bars
  const container = document.getElementById('guess-distribution');
  container.innerHTML = '';

  const maxCount  = Math.max(1, ...Object.values(dist));
  const todayBucket = today && today.status === 'won' ? today.guesses.length : null;

  [1, 2, 3, 4, 5, 6].forEach(n => {
    const count     = dist[n] || 0;
    const row       = document.createElement('div');
    row.className   = 'dist-row';

    const lbl       = document.createElement('div');
    lbl.className   = 'dist-label';
    lbl.textContent = n;

    const wrap      = document.createElement('div');
    wrap.className  = 'dist-bar-wrap';

    const bar       = document.createElement('div');
    bar.className   = 'dist-bar' + (n === todayBucket ? ' highlight' : '');
    bar.style.width = `${Math.max(4, (count / maxCount) * 100)}%`;

    const countEl      = document.createElement('span');
    countEl.className  = 'dist-count';
    countEl.textContent = count;

    bar.appendChild(countEl);
    wrap.appendChild(bar);
    row.appendChild(lbl);
    row.appendChild(wrap);
    container.appendChild(row);
  });
}

function showSettings() {
  applySettings(); // sync checkboxes before opening
  openModal('settings-modal');
}

function showEndModal() {
  const { today, streak } = gameState;
  const won               = today.status === 'won';

  // Title and message
  const titleEl   = document.getElementById('end-title');
  const msgEl     = document.getElementById('end-message');
  const streakEl  = document.getElementById('end-streak');

  if (won) {
    const guessCount = today.guesses.length;
    titleEl.textContent = guessCount === 1 ? 'Genius!' :
                          guessCount <= 2  ? 'Amazing!'  :
                          guessCount <= 3  ? 'Splendid!' :
                          guessCount <= 4  ? 'Great!'    :
                          guessCount <= 5  ? 'Phew!'     : 'Nice!';
    msgEl.textContent = `You got it in ${guessCount} guess${guessCount === 1 ? '' : 'es'}!`;
  } else {
    titleEl.textContent = 'Better Luck Tomorrow';
    const solStr = puzzle.solution.map(formatOp).join(' ');
    msgEl.textContent = `The solution was: ${solStr}`;
  }

  // Streak line (only if streak > 0)
  if (streak.current > 0) {
    streakEl.textContent = `🔥 ${streak.current} day streak!`;
  } else {
    streakEl.textContent = '';
  }

  // Countdown to next puzzle (midnight UTC)
  startCountdown();

  openModal('end-modal');
}

function startCountdown() {
  const countdownEl = document.getElementById('countdown');
  if (!countdownEl) return;

  function updateCountdown() {
    const now        = new Date();
    const midnight   = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const diff       = midnight - now;

    if (diff <= 0) {
      countdownEl.textContent = 'New puzzle available! Refresh to play.';
      if (countdownInterval) clearInterval(countdownInterval);
      return;
    }

    const h  = Math.floor(diff / 3_600_000);
    const m  = Math.floor((diff % 3_600_000) / 60_000);
    const s  = Math.floor((diff % 60_000)    / 1_000);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    countdownEl.textContent = `Next puzzle in ${hh}:${mm}:${ss}`;
  }

  updateCountdown();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 1000);
}

// ── Sharing ───────────────────────────────────────────────────────────────────

function generateShareText() {
  const { today, streak } = gameState;
  const puzzleNum  = puzzle.puzzleNumber ?? daysSinceLaunch(today.date);
  const won        = today.status === 'won';
  const guessCount = today.guesses.length;
  const score      = won ? `${guessCount}/6` : 'X/6';
  const streakLine = streak.current > 0 ? `   🔥${streak.current}` : '';

  const fail      = won ? '' : ' 💥';
  const titleLine = `Reckon #${puzzleNum} — ${score}${fail}${streakLine}`;

  const rows = today.guesses.map(guess =>
    guess.feedback.map(code => FEEDBACK_EMOJI[code] || '⬜').join('')
  ).join('\n');

  return `${titleLine}\n${rows}\n\nreckon.app`;
}

async function share() {
  const text = generateShareText();
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch {
    showToast('Could not copy — try manually.');
  }
}

// ── Confetti ─────────────────────────────────────────────────────────────────

function celebrateWin() {
  if (prefersReducedMotion()) return;

  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  canvas.style.display = 'block';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const ctx     = canvas.getContext('2d');
  const TOTAL   = 80;
  const FRAMES  = 300;
  const COLORS  = [
    '#6aaa64', '#c9b458', '#4a90d9', '#e8861a',
    '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
  ];

  const particles = Array.from({ length: TOTAL }, () => ({
    x:    Math.random() * canvas.width,
    y:    Math.random() * -canvas.height * 0.3 - 10,
    w:    Math.random() * 10 + 6,
    h:    Math.random() * 6  + 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    angle: Math.random() * Math.PI * 2,
    spin:  (Math.random() - 0.5) * 0.15,
    vx:   (Math.random() - 0.5) * 3,
    vy:   Math.random() * 3 + 2,
    gravity: 0.08 + Math.random() * 0.05,
  }));

  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();

      p.x     += p.vx;
      p.y     += p.vy;
      p.vy    += p.gravity;
      p.angle += p.spin;
    });

    frame++;
    if (frame < FRAMES) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }

  requestAnimationFrame(draw);
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** Apply settings to DOM and sync toggle checkboxes. */
function applySettings() {
  const { colorBlindMode, darkMode } = gameState.settings;

  const html = document.documentElement;
  html.classList.toggle('dark',         darkMode);
  html.classList.toggle('color-blind',  colorBlindMode);

  const cbToggle = document.getElementById('cb-toggle');
  const dmToggle = document.getElementById('dm-toggle');
  if (cbToggle) cbToggle.checked = colorBlindMode;
  if (dmToggle) dmToggle.checked = darkMode;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  gameState = loadState();
  doDailyReset();

  // Apply theme: use saved pref, or fall back to system
  if (!Object.hasOwn(gameState.settings, 'darkMode') ||
      gameState.settings.darkMode === false) {
    // Check if user had ever explicitly toggled dark mode; if not, check system
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Only auto-apply system pref if user hasn't explicitly set it before
    // (we detect "explicit set" by checking if there's saved state with a non-false darkMode)
    const hasSavedPref = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_STATE);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed && parsed.settings && Object.hasOwn(parsed.settings, 'darkMode');
      } catch { return false; }
    })();
    if (!hasSavedPref) {
      gameState.settings.darkMode = systemDark;
    }
  }
  applySettings();
  updateStreakBadge();

  // Load puzzle from API/cache
  await loadPuzzle();

  if (puzzle) {
    showEl('game-ui');
    render();

    // Restore current guess (if somehow cleared between operations — nothing to restore;
    // guesses already in today.guesses are past rows)
    currentGuess = [];
    updateSubmitBtn();

    // Auto-show end modal if game is already over from a previous session
    if (gameState.today.status !== 'in_progress') {
      // Small delay to let the board render first
      setTimeout(() => showEndModal(), 300);
    } else if (!gameState.seenOnboarding) {
      // First-time onboarding
      gameState.seenOnboarding = true;
      saveState();
      showOnboarding();
    }
  }

  // ── Event listeners ──────────────────────────────────────────────────────

  // Submit
  document.getElementById('submit-btn')?.addEventListener('click', onSubmit);

  // Header buttons
  document.getElementById('streak-btn')?.addEventListener('click', showStats);
  document.getElementById('settings-btn')?.addEventListener('click', showSettings);

  // Keyboard
  document.addEventListener('keydown', onKeydown);

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Modal overlay click to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAllModals();
    });
  });

  // Share button
  document.getElementById('share-btn')?.addEventListener('click', share);

  // Onboarding "Let's Play!" button
  document.getElementById('start-playing-btn')?.addEventListener('click', closeAllModals);

  // Settings toggles
  document.getElementById('cb-toggle')?.addEventListener('change', (e) => {
    gameState.settings.colorBlindMode = e.target.checked;
    saveState();
    applySettings();
    // Re-render board so tile classes update
    if (puzzle) renderBoard();
  });

  document.getElementById('dm-toggle')?.addEventListener('change', (e) => {
    gameState.settings.darkMode = e.target.checked;
    saveState();
    applySettings();
  });

  // "How to Play" link in settings
  document.getElementById('how-to-play-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllModals();
    showOnboarding();
  });

  // Retry buttons (reload page)
  document.getElementById('retry-btn')?.addEventListener('click',   () => location.reload());
  document.getElementById('retry-btn-2')?.addEventListener('click', () => location.reload());

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

document.addEventListener('DOMContentLoaded', init);
