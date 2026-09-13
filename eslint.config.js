import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/generated/**',
      'apps/web/public/sw.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: [
      '**/*.config.{js,mjs,ts}',
      '**/*.test.ts',
      '**/*.spec.ts',
      'scripts/**/*.ts',
      'vercel.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: [
      '*.config.ts',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'apps/web/e2e/**/*.ts',
      'apps/web/*.config.ts',
      'scripts/**/*.ts',
      'vercel.ts',
    ],
  },
  {
    files: ['performance/k6/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        __ENV: 'readonly',
        __ITER: 'readonly',
        __VU: 'readonly',
      },
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
);
