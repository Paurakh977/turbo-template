import { config as baseConfig } from "./base.js";
import globals from "globals";

/**
 * A custom ESLint configuration for Node.js libraries.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const libraryConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        React: true,
        JSX: true,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
  },
  {
    ignores: [".*.js", "node_modules/", "dist/"],
  },
];

export default libraryConfig;
