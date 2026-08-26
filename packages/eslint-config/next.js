import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import pluginNext from "@next/eslint-plugin-next";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    //  the root @repo/auth entry instantiates the full
    // BetterAuth runtime (pg pool, signing secret). Web must only import the
    // pure subpaths (/roles, /permissions, /password-policy) or use type-only
    // imports. Regression here silently recreates a second auth instance.
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@repo/auth",
              allowTypeImports: true,
              message:
                "Use '@repo/auth/roles' | '@repo/auth/permissions' | '@repo/auth/password-policy' (or `import type`). The root entry boots BetterAuth + a DB pool.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [".next/**", "dist/**", "node_modules/**", "next-env.d.ts"],
  },
];
