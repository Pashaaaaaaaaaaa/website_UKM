import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.next-dev/**', '**/coverage/**', '**/next-env.d.ts'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.ts'], languageOptions: { globals: { ...globals.node, ...globals.es2022 } } },
  { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.es2022 } } },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } }, plugins: { '@typescript-eslint': tsPlugin }, rules: { ...tsPlugin.configs.recommended.rules, 'no-undef': 'off' } },
];
