'use strict';

const { DEFAULT_CONFIG } = require('./generator');

/**
 * Pack catalog — single source of truth for all puzzle packs.
 *
 * unlock.type:
 *   'free'    — always available, no key required
 *   'streak'  — unlocked automatically when streak reaches unlock.streakDays
 *   'purchase' — requires a valid license key (obtained via Stripe or coupon)
 *
 * generator: difficulty config passed to generatePuzzle(). null for archive
 *   (archive puzzles come from existing daily blobs, not fresh generation).
 */
const PACKS = [
  {
    id:          'practice',
    name:        'Practice Pack',
    emoji:       '🧩',
    description: 'Ten bonus puzzles at the standard daily difficulty. A good warm-up.',
    puzzleCount: 10,
    unlock:      { type: 'free' },
    generator:   { ...DEFAULT_CONFIG },   // same as daily
    stripePrice: null,
  },
  {
    id:          'loyal',
    name:        'Loyal Pack',
    emoji:       '🔥',
    description: 'Twenty puzzles unlocked by maintaining a 14-day streak. You earned it.',
    puzzleCount: 20,
    unlock:      { type: 'streak', streakDays: 14 },
    generator:   { ...DEFAULT_CONFIG },
    stripePrice: null,
  },
  {
    id:          'hard',
    name:        'Hard Pack',
    emoji:       '💪',
    description: 'Thirty puzzles with larger numbers and tighter chains. Expect a challenge.',
    puzzleCount: 30,
    unlock:      { type: 'purchase' },
    generator:   {
      ...DEFAULT_CONFIG,
      operandMax:        12,
      targetMin:         100,
      targetMax:         999,
      maxPerFamily:      3,
    },
    stripePrice: process.env.STRIPE_PRICE_HARD || null,
  },
  {
    id:          'expert',
    name:        'Expert Pack',
    emoji:       '🧠',
    description: 'Thirty puzzles with operands up to 15 and targets into the thousands.',
    puzzleCount: 30,
    unlock:      { type: 'purchase' },
    generator:   {
      ...DEFAULT_CONFIG,
      operandMax:        15,
      targetMin:         200,
      targetMax:         9999,
      maxPerFamily:      3,
    },
    stripePrice: process.env.STRIPE_PRICE_EXPERT || null,
  },
  {
    id:          'archive',
    name:        'Daily Archive',
    emoji:       '📅',
    description: 'Every past daily puzzle, playable on demand. Build your history.',
    puzzleCount: null,   // grows over time
    unlock:      { type: 'purchase' },
    generator:   null,   // puzzles come from existing daily blobs
    stripePrice: process.env.STRIPE_PRICE_ARCHIVE || null,
  },
];

const OMIT_FROM_PUBLIC = new Set(['stripePrice', 'generator']);

/** Return the pack catalog without Stripe price IDs (safe for public API). */
function getPublicCatalog() {
  return PACKS.map(p =>
    Object.fromEntries(Object.entries(p).filter(([k]) => !OMIT_FROM_PUBLIC.has(k)))
  );
}

/** Find a pack by ID. Returns undefined if not found. */
function findPack(id) {
  return PACKS.find(p => p.id === id);
}

/** Return packs that are always free (no key check needed). */
function getFreePacks() {
  return PACKS.filter(p => p.unlock.type === 'free');
}

/** Return packs unlocked by streak milestones. */
function getStreakPacks() {
  return PACKS.filter(p => p.unlock.type === 'streak');
}

module.exports = { PACKS, findPack, getPublicCatalog, getFreePacks, getStreakPacks };
