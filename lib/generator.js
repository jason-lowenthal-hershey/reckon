'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Randomness (crypto-backed, NOT Math.random)
// ---------------------------------------------------------------------------

/**
 * Return a random integer in [min, max] inclusive using crypto.randomBytes.
 */
function randInt(min, max) {
  const range = max - min + 1;
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return min + (n % range);
}

// ---------------------------------------------------------------------------
// Operation helpers
// ---------------------------------------------------------------------------

/**
 * Apply a single operation to a value.
 * op = { operator: '+' | '-' | '*' | '/', operand: 2-9 }
 */
function applyOp(value, op) {
  switch (op.operator) {
    case '+': return value + op.operand;
    case '-': return value - op.operand;
    case '*': return value * op.operand;
    case '/': return value / op.operand;
    default: throw new Error(`Unknown operator: ${op.operator}`);
  }
}

/**
 * Apply a sequence of operations left-to-right starting from start.
 */
function applyAll(start, ops) {
  let value = start;
  for (const op of ops) {
    value = applyOp(value, op);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Combinatorics helpers
// ---------------------------------------------------------------------------

/**
 * Generate all ordered r-subsets (permutations) of arr.
 * Returns a plain array — avoids generator-function compatibility issues
 * in some serverless sandboxes.
 * P(7,5) = 2520 items; well within memory limits.
 */
function permutations(arr, r) {
  if (r === 0) return [[]];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    const subPerms = permutations(rest, r - 1);
    for (let j = 0; j < subPerms.length; j++) {
      result.push([arr[i]].concat(subPerms[j]));
    }
  }
  return result;
}

/**
 * Fisher-Yates shuffle in-place using randInt (crypto-backed).
 * Returns the array (mutated).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Solution generation
// ---------------------------------------------------------------------------

const OPERATORS = ['+', '-', '*', '/'];
const OPERANDS = [2, 3, 4, 5, 6, 7, 8, 9];

function opKey(op) {
  return `${op.operator}${op.operand}`;
}

function isMultiplicative(op) {
  return op.operator === '*' || op.operator === '/';
}

function isAdditive(op) {
  return op.operator === '+' || op.operator === '-';
}

/**
 * Check whether applying op to value yields a positive integer.
 */
function yieldsPositiveInteger(value, op) {
  const result = applyOp(value, op);
  if (result <= 0) return false;
  if (!Number.isInteger(result)) return false;
  return true;
}

/**
 * Attempt to build a 5-op solution starting from `start`.
 * Returns { solution, target } or null if generation fails.
 *
 * Constraints:
 *   - Each op yields a positive integer when applied to the running value
 *   - No op is used twice (distinct by operator+operand key)
 *   - At least 1 multiplicative (* or /)
 *   - At least 1 additive (+ or -)
 *   - At most 3 ops from any single family
 *   - target in [20, 250]
 *
 * Uses backtracking with up to 200 total attempts.
 */
function generateSolution(start) {
  const MAX_ATTEMPTS = 200;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const solution = [];
    const usedKeys = new Set();
    let current = start;
    let stuck = false;

    for (let step = 0; step < 5; step++) {
      // Determine current family counts
      const multCount = solution.filter(isMultiplicative).length;
      const addCount = solution.filter(isAdditive).length;
      const remaining = 5 - step; // slots left including this one

      // Build candidate list, shuffle it, try each
      const candidates = [];
      for (const operator of OPERATORS) {
        for (const operand of OPERANDS) {
          const op = { operator, operand };
          const key = opKey(op);

          if (usedKeys.has(key)) continue;

          // Family cap: at most 3 of any family
          if (isMultiplicative(op) && multCount >= 3) continue;
          if (isAdditive(op) && addCount >= 3) continue;

          // Must still be possible to satisfy the "at least 1" constraints
          // with the remaining slots (including this one)
          const wouldHaveMult = multCount + (isMultiplicative(op) ? 1 : 0);
          const wouldHaveAdd = addCount + (isAdditive(op) ? 1 : 0);
          const afterThisRemaining = remaining - 1;

          // After placing this op, we need to be able to still satisfy:
          //   at least 1 mult total → if wouldHaveMult === 0, we need at least 1 in remaining-1 slots
          //   at least 1 add total  → same logic
          if (wouldHaveMult === 0 && afterThisRemaining === 0) continue;
          if (wouldHaveAdd === 0 && afterThisRemaining === 0) continue;

          if (!yieldsPositiveInteger(current, op)) continue;

          candidates.push(op);
        }
      }

      if (candidates.length === 0) {
        stuck = true;
        break;
      }

      shuffle(candidates);
      const chosen = candidates[0];
      solution.push(chosen);
      usedKeys.add(opKey(chosen));
      current = applyOp(current, chosen);
    }

    if (stuck) continue;

    // Validate family constraints
    const multCount = solution.filter(isMultiplicative).length;
    const addCount = solution.filter(isAdditive).length;
    if (multCount < 1 || addCount < 1) continue;

    const target = applyAll(start, solution);
    if (target < 20 || target > 250) continue;

    return { solution, target };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Decoy generation
// ---------------------------------------------------------------------------

/**
 * Pick 2 decoy ops that are:
 *   - Not in the solution
 *   - Distinct from each other
 *   - Operands in [2, 9]
 *
 * Returns an array of 2 ops, or null if unable.
 */
function generateDecoys(solution) {
  const solutionKeys = new Set(solution.map(opKey));

  // Collect all possible ops not already in the solution
  const candidates = [];
  for (const operator of OPERATORS) {
    for (const operand of OPERANDS) {
      const op = { operator, operand };
      if (!solutionKeys.has(opKey(op))) {
        candidates.push(op);
      }
    }
  }

  if (candidates.length < 2) return null;

  shuffle(candidates);
  return [candidates[0], candidates[1]];
}

// ---------------------------------------------------------------------------
// Uniqueness check
// ---------------------------------------------------------------------------

/**
 * Return true iff exactly one ordered 5-permutation of `pool` produces
 * a result within 1e-9 of `target` when applied to `start`.
 *
 * Brute-forces all P(7,5) = 2520 permutations.
 */
function isUnique(start, target, pool) {
  let count = 0;
  for (const perm of permutations(pool, 5)) {
    const result = applyAll(start, perm);
    if (Math.abs(result - target) < 1e-9) {
      count++;
      if (count > 1) return false;
    }
  }
  return count === 1;
}

// ---------------------------------------------------------------------------
// Top-level puzzle generator
// ---------------------------------------------------------------------------

/**
 * Generate a valid puzzle.
 *
 * Returns:
 * {
 *   start: number,
 *   target: number,
 *   pool: Array<{operator, operand}>,   // 7 ops, shuffled
 *   solution: Array<{operator, operand}>, // 5 ops in solution order
 *   puzzleNumber: number
 * }
 *
 * Throws if unable to generate after MAX_OUTER_ATTEMPTS.
 */
function generatePuzzle(puzzleNumber) {
  const MAX_OUTER_ATTEMPTS = 200;

  for (let attempt = 0; attempt < MAX_OUTER_ATTEMPTS; attempt++) {
    const start = randInt(5, 20);

    const solResult = generateSolution(start);
    if (solResult === null) continue;

    const { solution, target } = solResult;

    const decoys = generateDecoys(solution);
    if (decoys === null) continue;

    const pool = shuffle([...solution, ...decoys]);

    if (!isUnique(start, target, pool)) continue;

    return { start, target, pool, solution, puzzleNumber };
  }

  throw new Error(`generatePuzzle: failed to produce a valid puzzle after ${MAX_OUTER_ATTEMPTS} attempts`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  randInt,
  applyOp,
  applyAll,
  permutations,
  shuffle,
  generateSolution,
  generateDecoys,
  isUnique,
  generatePuzzle,
};
