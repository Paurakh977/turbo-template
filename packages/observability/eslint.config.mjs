import { libraryConfig } from '@repo/eslint-config/library';

/** @type {import("eslint").Linter.Config} */
export default [
  ...libraryConfig,
  {
    ignores: ['eslint.config.mjs'],
  },
];
