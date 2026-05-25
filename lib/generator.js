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
    const swapVal = arr[i];
    arr[i] = arr[j];
    arr[j] = swapVal;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Difficulty configuration
// ---------------------------------------------------------------------------

/**
 * Default difficulty configuration for the daily puzzle.
 * All generateX functions accept an optional config that overrides these.
 */
const DEFAULT_CONFIG = {
  startMin:          5,
  startMax:          20,
  operandMin:        2,
  operandMax:        9,
  targetMin:         50,   // raised from 20
  targetMax:         500,  // raised from 250
  solutionLength:    5,
  poolSize:          10,   // solutionLength + 5 decoys
  minMultiplicative: 1,
  minAdditive:       1,
  // With solutionLength=5 and two families, the maximum useful cap is 3
  // (forces a 3+2 family split instead of 4+1 or 5+0, breaking predictable patterns).
  maxPerFamily:      3,
};

/**
 * Build the operand array from config bounds.
 */
function buildOperands(config) {
  const ops = [];
  for (let i = config.operandMin; i <= config.operandMax; i++) ops.push(i);
  return ops;
}

// ---------------------------------------------------------------------------
// Solution generation
// ---------------------------------------------------------------------------

const OPERATORS = ['+', '-', '*', '/'];

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
 * Attempt to build a solution starting from `start`.
 * Returns { solution, target } or null if generation fails.
 *
 * Constraints:
 *   - Each op yields a positive integer when applied to the running value
 *   - No op is used twice (distinct by operator+operand key)
 *   - At least config.minMultiplicative multiplicative (* or /) ops
 *   - At least config.minAdditive additive (+ or -) ops
 *   - At most config.maxPerFamily ops from any single family
 *   - target in [config.targetMin, config.targetMax]
 *
 * Uses backtracking with up to 200 total attempts.
 */
function generateSolution(start, config) {
  const OPERANDS = buildOperands(config);
  const MAX_ATTEMPTS = 200;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const solution = [];
    const usedKeys = new Set();
    let current = start;
    let stuck = false;

    for (let step = 0; step < config.solutionLength; step++) {
      // Determine current family counts
      const multCount = solution.filter(isMultiplicative).length;
      const addCount = solution.filter(isAdditive).length;
      const remaining = config.solutionLength - step; // slots left including this one

      // Build candidate list, shuffle it, try each
      const candidates = [];
      for (const operator of OPERATORS) {
        for (const operand of OPERANDS) {
          const op = { operator, operand };
          const key = opKey(op);

          if (usedKeys.has(key)) continue;

          // Family cap: at most config.maxPerFamily of any family
          if (isMultiplicative(op) && multCount >= config.maxPerFamily) continue;
          if (isAdditive(op) && addCount >= config.maxPerFamily) continue;

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
    if (multCount < config.minMultiplicative || addCount < config.minAdditive) continue;

    const target = applyAll(start, solution);
    if (target < config.targetMin || target > config.targetMax) continue;

    return { solution, target };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Decoy generation
// ---------------------------------------------------------------------------

/**
 * Pick decoy ops (pool size = config.poolSize: config.solutionLength solution +
 * (config.poolSize - config.solutionLength) decoys) that are:
 *   - Not in the solution
 *   - Distinct from each other
 *   - Operands in [config.operandMin, config.operandMax]
 *   - Each added decoy preserves uniqueness (no new solution paths are created)
 *
 * Decoys are added incrementally: a candidate is accepted only if the growing
 * pool remains unique after its addition.  This avoids the near-0% pass rate
 * that occurs when decoys are chosen blindly and then checked all at once.
 *
 * Returns an array of decoys, or null if unable.
 */
function generateDecoys(solution, start, target, config) {
  const OPERANDS = buildOperands(config);
  const decoyCount = config.poolSize - config.solutionLength;
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

  if (candidates.length < decoyCount) return null;

  shuffle(candidates);

  // Add decoys one at a time, accepting only those that keep the pool unique.
  const decoys = [];
  const growingPool = [...solution];

  for (const candidate of candidates) {
    if (decoys.length >= decoyCount) break;
    growingPool.push(candidate);
    if (isUnique(start, target, growingPool, config.solutionLength)) {
      decoys.push(candidate);
    } else {
      growingPool.pop(); // reject — this decoy opens up alternative solutions
    }
  }

  return decoys.length === decoyCount ? decoys : null;
}

// ---------------------------------------------------------------------------
// Uniqueness check
// ---------------------------------------------------------------------------

/**
 * Return true iff exactly one ordered solutionLength-permutation of `pool`
 * produces a result within 1e-9 of `target` when applied to `start`.
 *
 * Brute-forces all P(pool.length, solutionLength) permutations
 * (up to P(10,5) = 30,240).
 */
function isUnique(start, target, pool, solutionLength = 5) {
  let count = 0;
  for (const perm of permutations(pool, solutionLength)) {
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
 *   pool: Array<{operator, operand}>,   // config.poolSize ops, shuffled
 *   solution: Array<{operator, operand}>, // config.solutionLength ops in solution order
 *   puzzleNumber: number
 * }
 *
 * Throws if unable to generate after MAX_OUTER_ATTEMPTS.
 */
function generatePuzzle(puzzleNumber, config = DEFAULT_CONFIG) {
  // The incremental decoy strategy keeps the pass rate high even with a
  // 10-op pool (P(10,5)=30240), so 500 outer attempts is more than enough.
  const MAX_OUTER_ATTEMPTS = 500;

  for (let attempt = 0; attempt < MAX_OUTER_ATTEMPTS; attempt++) {
    const start = randInt(config.startMin, config.startMax);

    const solResult = generateSolution(start, config);
    if (solResult === null) continue;

    const { solution, target } = solResult;

    const decoys = generateDecoys(solution, start, target, config);
    if (decoys === null) continue;

    // Uniqueness is already guaranteed by generateDecoys' incremental check.
    const pool = shuffle([...solution, ...decoys]);

    return { start, target, pool, solution, puzzleNumber };
  }

  throw new Error(`generatePuzzle: failed to produce a valid puzzle after ${MAX_OUTER_ATTEMPTS} attempts`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DEFAULT_CONFIG,
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
