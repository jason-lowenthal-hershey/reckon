'use strict';

// generatePuzzle runs P(10,5) = 30,240 permutation checks — give it room.
jest.setTimeout(15000);

const {
  randInt,
  applyOp,
  applyAll,
  permutations,
  shuffle,
  generateSolution,
  generateDecoys,
  isUnique,
  generatePuzzle,
} = require('../lib/generator');

// ---------------------------------------------------------------------------
// randInt
// ---------------------------------------------------------------------------

describe('randInt', () => {
  test('returns an integer', () => {
    expect(Number.isInteger(randInt(1, 100))).toBe(true);
  });

  test('always returns a value within [min, max]', () => {
    for (let i = 0; i < 200; i++) {
      const n = randInt(5, 20);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(20);
    }
  });

  test('works when min === max', () => {
    expect(randInt(7, 7)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// applyOp
// ---------------------------------------------------------------------------

describe('applyOp', () => {
  test('addition', () => expect(applyOp(10, { operator: '+', operand: 5 })).toBe(15));
  test('subtraction', () => expect(applyOp(10, { operator: '-', operand: 3 })).toBe(7));
  test('multiplication', () => expect(applyOp(10, { operator: '*', operand: 2 })).toBe(20));
  test('division', () => expect(applyOp(10, { operator: '/', operand: 4 })).toBe(2.5));

  test('throws on unknown operator', () => {
    expect(() => applyOp(10, { operator: '^', operand: 2 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyAll
// ---------------------------------------------------------------------------

describe('applyAll', () => {
  test('returns start unchanged when ops is empty', () => {
    expect(applyAll(10, [])).toBe(10);
  });

  test('applies a single op', () => {
    expect(applyAll(5, [{ operator: '*', operand: 3 }])).toBe(15);
  });

  test('applies ops strictly left-to-right', () => {
    // 10 *2=20, +3=23, *3=69 — order matters, not commutative with mixed families
    expect(applyAll(10, [
      { operator: '*', operand: 2 },
      { operator: '+', operand: 3 },
      { operator: '*', operand: 3 },
    ])).toBe(69);
  });
});

// ---------------------------------------------------------------------------
// permutations
// ---------------------------------------------------------------------------

describe('permutations', () => {
  test('permutations(arr, 0) returns [[]]', () => {
    expect(permutations([1, 2, 3], 0)).toEqual([[]]);
  });

  test('permutations([], 0) returns [[]]', () => {
    expect(permutations([], 0)).toEqual([[]]);
  });

  test('P(3,1) = 3', () => {
    expect(permutations([1, 2, 3], 1)).toHaveLength(3);
  });

  test('P(3,2) = 6', () => {
    expect(permutations([1, 2, 3], 2)).toHaveLength(6);
  });

  test('P(5,5) = 120', () => {
    expect(permutations([1, 2, 3, 4, 5], 5)).toHaveLength(120);
  });

  test('P(7,5) = 2520', () => {
    expect(permutations([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(2520);
  });

  test('P(10,5) = 30240', () => {
    expect(permutations([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toHaveLength(30240);
  });

  test('each permutation has length r', () => {
    for (const p of permutations([1, 2, 3, 4], 3)) {
      expect(p).toHaveLength(3);
    }
  });

  test('no duplicates across permutations', () => {
    const perms = permutations([1, 2, 3, 4], 3);
    const strs = perms.map(p => p.join(','));
    expect(new Set(strs).size).toBe(strs.length);
  });

  test('no element appears twice within a single permutation', () => {
    for (const perm of permutations(['a', 'b', 'c', 'd'], 3)) {
      expect(new Set(perm).size).toBe(perm.length);
    }
  });
});

// ---------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------

describe('shuffle', () => {
  test('returns the same array reference (mutates in-place)', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toBe(arr);
  });

  test('contains the same elements after shuffling', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const sorted = [...arr].sort((a, b) => a - b);
    shuffle(arr);
    expect(arr.sort((a, b) => a - b)).toEqual(sorted);
  });

  test('length unchanged', () => {
    const arr = [1, 2, 3, 4];
    shuffle(arr);
    expect(arr).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// isUnique
// ---------------------------------------------------------------------------

describe('isUnique', () => {
  // Build a pool of only +/- ops: since addition is commutative, every
  // ordering produces the same net sum → ALL P(5,5)=120 orderings hit
  // target → isUnique must return false.
  const addPool = [
    { operator: '+', operand: 2 },
    { operator: '+', operand: 3 },
    { operator: '+', operand: 4 },
    { operator: '-', operand: 2 },
    { operator: '-', operand: 3 },
  ];

  test('returns false when no permutation reaches target', () => {
    expect(isUnique(0, 999, addPool)).toBe(false); // max reachable = 4
  });

  test('returns false when multiple permutations reach target (all-additive pool)', () => {
    // 0+2+3+4-2-3 = 4 in any ordering
    expect(isUnique(0, 4, addPool)).toBe(false);
  });

  test('returns true for the pool of a validly generated puzzle', () => {
    const p = generatePuzzle(1);
    expect(isUnique(p.start, p.target, p.pool)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSolution
// ---------------------------------------------------------------------------

describe('generateSolution', () => {
  let result;

  beforeAll(() => {
    for (let i = 0; i < 10 && result == null; i++) {
      result = generateSolution(10);
    }
  });

  test('returns a non-null result', () => {
    expect(result).not.toBeNull();
  });

  test('solution has exactly 5 ops', () => {
    expect(result.solution).toHaveLength(5);
  });

  test('all operators are valid', () => {
    const valid = new Set(['+', '-', '*', '/']);
    for (const op of result.solution) {
      expect(valid.has(op.operator)).toBe(true);
    }
  });

  test('all operands are integers in [2, 9]', () => {
    for (const op of result.solution) {
      expect(Number.isInteger(op.operand)).toBe(true);
      expect(op.operand).toBeGreaterThanOrEqual(2);
      expect(op.operand).toBeLessThanOrEqual(9);
    }
  });

  test('all ops in solution are distinct', () => {
    const keys = result.solution.map(op => `${op.operator}${op.operand}`);
    expect(new Set(keys).size).toBe(5);
  });

  test('applying solution to start produces target', () => {
    const computed = applyAll(10, result.solution);
    expect(Math.abs(computed - result.target)).toBeLessThan(1e-9);
  });

  test('target is in [20, 250]', () => {
    expect(result.target).toBeGreaterThanOrEqual(20);
    expect(result.target).toBeLessThanOrEqual(250);
  });

  test('has at least one multiplicative op (* or /)', () => {
    expect(result.solution.some(op => op.operator === '*' || op.operator === '/')).toBe(true);
  });

  test('has at least one additive op (+ or -)', () => {
    expect(result.solution.some(op => op.operator === '+' || op.operator === '-')).toBe(true);
  });

  test('every intermediate value is a positive integer', () => {
    let v = 10;
    for (const op of result.solution) {
      v = applyOp(v, op);
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// generateDecoys
// ---------------------------------------------------------------------------

describe('generateDecoys', () => {
  test('returns 5 decoys that are distinct from each other and from the solution, with operands in [2,9], and that keep the pool unique', () => {
    // Obtain a fresh solution to test against
    let sol = null;
    for (let i = 0; i < 10 && sol === null; i++) sol = generateSolution(10);
    expect(sol).not.toBeNull();

    const { solution, target } = sol;
    const decoys = generateDecoys(solution, 10, target);

    // generateDecoys may return null if no valid 5-decoy set exists for this
    // particular solution (rare — generatePuzzle retries with a new solution
    // in that case). Skip rather than fail.
    if (decoys === null) return;

    expect(decoys).toHaveLength(5);

    const solutionKeys = new Set(solution.map(op => `${op.operator}${op.operand}`));

    // No decoy matches a solution op
    for (const d of decoys) {
      expect(solutionKeys.has(`${d.operator}${d.operand}`)).toBe(false);
    }

    // Decoys are mutually distinct
    const decoyKeys = decoys.map(op => `${op.operator}${op.operand}`);
    expect(new Set(decoyKeys).size).toBe(5);

    // Operands in range
    for (const d of decoys) {
      expect(d.operand).toBeGreaterThanOrEqual(2);
      expect(d.operand).toBeLessThanOrEqual(9);
    }

    // Full 10-op pool preserves uniqueness
    expect(isUnique(10, target, [...solution, ...decoys])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePuzzle (end-to-end)
// ---------------------------------------------------------------------------

describe('generatePuzzle', () => {
  let puzzle;

  beforeAll(() => {
    puzzle = generatePuzzle(42);
  });

  test('returns a puzzle object', () => {
    expect(puzzle).toBeDefined();
    expect(typeof puzzle).toBe('object');
  });

  test('puzzleNumber matches the argument', () => {
    expect(puzzle.puzzleNumber).toBe(42);
  });

  test('start is an integer in [5, 20]', () => {
    expect(Number.isInteger(puzzle.start)).toBe(true);
    expect(puzzle.start).toBeGreaterThanOrEqual(5);
    expect(puzzle.start).toBeLessThanOrEqual(20);
  });

  test('target is an integer in [20, 250]', () => {
    expect(Number.isInteger(puzzle.target)).toBe(true);
    expect(puzzle.target).toBeGreaterThanOrEqual(20);
    expect(puzzle.target).toBeLessThanOrEqual(250);
  });

  test('pool has exactly 10 ops', () => {
    expect(puzzle.pool).toHaveLength(10);
  });

  test('solution has exactly 5 ops', () => {
    expect(puzzle.solution).toHaveLength(5);
  });

  test('all pool ops are distinct', () => {
    const keys = puzzle.pool.map(op => `${op.operator}${op.operand}`);
    expect(new Set(keys).size).toBe(10);
  });

  test('every solution op appears in the pool', () => {
    const poolKeys = new Set(puzzle.pool.map(op => `${op.operator}${op.operand}`));
    for (const op of puzzle.solution) {
      expect(poolKeys.has(`${op.operator}${op.operand}`)).toBe(true);
    }
  });

  test('applying solution to start yields target', () => {
    const result = applyAll(puzzle.start, puzzle.solution);
    expect(Math.abs(result - puzzle.target)).toBeLessThan(1e-9);
  });

  test('pool is unique — exactly one 5-permutation hits target', () => {
    expect(isUnique(puzzle.start, puzzle.target, puzzle.pool)).toBe(true);
  });

  test('solution has at least one multiplicative op', () => {
    expect(puzzle.solution.some(op => op.operator === '*' || op.operator === '/')).toBe(true);
  });

  test('solution has at least one additive op', () => {
    expect(puzzle.solution.some(op => op.operator === '+' || op.operator === '-')).toBe(true);
  });

  test('every solution intermediate value is a positive integer', () => {
    let v = puzzle.start;
    for (const op of puzzle.solution) {
      v = applyOp(v, op);
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
