'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // -------------------------------------------------------------------------
  // Files to ignore
  // -------------------------------------------------------------------------
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },

  // -------------------------------------------------------------------------
  // Node.js: API routes, generator, scripts, and tests
  // -------------------------------------------------------------------------
  {
    files: ['api/**/*.js', 'lib/**/*.js', 'scripts/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // -------------------------------------------------------------------------
  // Test files: Node + Jest globals
  // -------------------------------------------------------------------------
  {
    files: ['tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },

  // -------------------------------------------------------------------------
  // Browser SPA (public/)
  // -------------------------------------------------------------------------
  {
    files: ['public/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
];
