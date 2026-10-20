// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const PURE_LAYERS = ["src/domain/**/*.ts", "src/application/**/*.ts"];
const SCRIPT_PATHS = ["scripts/**/*.{js,mjs,ts}", "tests/fixtures/**/*"];

// Shared parser options — use projectService for fast type-aware linting.
// projectService replaces the old `project: "./tsconfig.json"` approach; it
// spins up one language service shared across all files rather than one per file.
const TS_PARSER_OPTS = {
  parser: tsParser,
  parserOptions: {
    projectService: true,
    tsconfigRootDir: import.meta.dirname,
  },
};

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ─── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "tests/fixtures/**", "pnpm-lock.yaml"],
  },

  // ─── Base TypeScript rules (all src/**) ──────────────────────────────────────
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: TS_PARSER_OPTS,
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },

  // ─── Pure-layer guardrails (domain + application) ────────────────────────────
  {
    files: PURE_LAYERS,
    languageOptions: TS_PARSER_OPTS,
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Date",
          message:
            "Do not use Date in domain/application. Inject Clock (src/domain/shared/clock.ts) instead.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "Do not call Date.now() in domain/application. Inject Clock instead.",
        },
        {
          object: "Math",
          property: "random",
          message: "Do not call Math.random() in domain/application. Inject IdGenerator instead.",
        },
        {
          object: "crypto",
          property: "randomUUID",
          message:
            "Do not call crypto.randomUUID() in domain/application. Inject IdGenerator instead.",
        },
        {
          object: "console",
          property: "log",
          message: "Do not use console.* in domain/application. Use the logger port instead.",
        },
        {
          object: "console",
          property: "error",
          message: "Do not use console.* in domain/application. Use the logger port instead.",
        },
        {
          object: "console",
          property: "warn",
          message: "Do not use console.* in domain/application. Use the logger port instead.",
        },
        {
          object: "console",
          property: "info",
          message: "Do not use console.* in domain/application. Use the logger port instead.",
        },
        {
          object: "console",
          property: "debug",
          message: "Do not use console.* in domain/application. Use the logger port instead.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Do not use new Date() in domain/application. Inject Clock instead.",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Do not read process.env in domain/application. Config is injected from infrastructure/config.",
        },
      ],
    },
  },

  // ─── TypeScript scripts (scripts/**/*.ts) ────────────────────────────────────
  {
    files: ["scripts/**/*.ts"],
    languageOptions: TS_PARSER_OPTS,
    plugins: { "@typescript-eslint": tseslint },
    rules: { "no-console": "off" },
  },

  // ─── Scripts & JS tooling — allow console.* ─────────────────────────────────
  {
    files: ["scripts/**/*.{js,mjs}", "tests/fixtures/**/*"],
    rules: { "no-console": "off" },
  },

  // ─── Test files ──────────────────────────────────────────────────────────────
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: TS_PARSER_OPTS,
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      eqeqeq: ["error", "always"],
      "no-console": "off",
    },
  },
];
