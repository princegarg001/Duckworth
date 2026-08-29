// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Two rules here do real work beyond style:
 *
 * 1. **Architecture is enforced, not documented.** `eslint-plugin-boundaries`
 *    makes the layering a build failure rather than a convention: a route
 *    cannot import a repository, a repository cannot import a route, and the
 *    domain package cannot import anything with I/O in it. A layering rule
 *    that lives only in a README is a layering rule that has already been
 *    broken somewhere.
 *
 * 2. **String-concatenated SQL is banned.** Every query goes through a tagged
 *    template, which parameterises. The two places that legitimately need a
 *    dynamic identifier resolve it through a closed lookup and are annotated.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      'apps/web/src/lib/api-types.ts', // generated
      'packages/db/migrations/**', // generated
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `any` defeats the point of the strict compiler settings.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Structured logging or nothing.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Catches `sql.unsafe('select ... ' + value)` and template literals
          // interpolated into a raw string before reaching the driver.
          selector:
            "CallExpression[callee.property.name='unsafe'] > BinaryExpression[operator='+']",
          message:
            'Do not build SQL by concatenation. Use a tagged template (which parameterises), or pass values as the second argument to `sql.unsafe`.',
        },
      ],
    },
  },

  // ── Layering ──────────────────────────────────────────────────────────────
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'routes', pattern: 'apps/api/src/routes/*' },
        { type: 'plugins', pattern: 'apps/api/src/plugins/*' },
        { type: 'repositories', pattern: 'apps/api/src/repositories/*' },
        { type: 'app', pattern: 'apps/api/src/{app,server,openapi-emit}.ts', mode: 'file' },
        { type: 'tests', pattern: 'apps/api/src/__tests__/**' },
      ],
      'boundaries/include': ['apps/api/src/**/*.ts'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Routes bind HTTP and call repositories. They never reach past
            // that, and nothing reaches back into them.
            { from: 'routes', allow: ['repositories', 'plugins'] },
            { from: 'repositories', allow: ['repositories'] },
            { from: 'plugins', allow: ['plugins'] },
            { from: 'app', allow: ['routes', 'plugins', 'repositories'] },
            { from: 'tests', allow: ['routes', 'plugins', 'repositories', 'app', 'tests'] },
          ],
        },
      ],
    },
  },

  // The domain package is pure: no database, no HTTP, no clock, no filesystem.
  // That is what lets it be tested exhaustively and reasoned about.
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'postgres', message: 'The domain layer must not perform I/O.' },
            { name: 'drizzle-orm', message: 'The domain layer must not know about the database.' },
            { name: 'fastify', message: 'The domain layer must not know about HTTP.' },
            { name: 'ioredis', message: 'The domain layer must not perform I/O.' },
          ],
          patterns: ['node:fs*', 'node:net*', 'node:http*', '@ipl/db*'],
        },
      ],
    },
  },

  // Tests may reach for the shapes that production code may not.
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-console': 'off',
    },
  },

  // The ingest CLI is a terminal program; writing to stdout is its job.
  {
    files: ['apps/ingest/src/cli.ts', 'apps/api/src/openapi-emit.ts', 'packages/config/src/**'],
    rules: { 'no-console': 'off' },
  },
);
