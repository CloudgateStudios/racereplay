import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react (bundled in eslint-config-next) calls context.getFilename()
  // which was removed in ESLint 10. Setting an explicit version bypasses detection.
  {
    settings: {
      react: { version: "19.0" },
    },
  },
  // Override default ignores of eslint-config-next.
  // Allow unused vars/args that start with _ (destructuring discard pattern).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
