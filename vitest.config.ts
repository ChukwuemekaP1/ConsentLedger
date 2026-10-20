import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Two named projects: unit (no I/O) and integration (needs DATABASE_URL).
    // Run with: vitest run --project unit   or   vitest run --project integration
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/unit/setup.ts"],
          // Unit tests must never touch the network or database.
          // Enforced here by never setting DATABASE_URL in this project.
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 60000,
          hookTimeout: 60000,
          // Integration tests require DATABASE_URL to be set externally.
          // The verify-int.mjs script skips this project locally when absent.
        },
      },
    ],

    // Coverage applies to the unit project only (via --project unit --coverage).
    // Thresholds for domain/ are set to 95% lines / 90% branches.
    //
    // NOTE: thresholds only apply once files exist. If domain/ contains only
    // empty index.ts stubs, coverage will be 100% (trivially). The thresholds
    // become meaningful from issue #2 onward when domain logic is added.
    // To enforce: run `vitest run --project unit --coverage` — it will fail
    // if coverage drops below the threshold once real code exists.
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      exclude: ["src/domain/**/index.ts", "src/domain/**/*.d.ts"],
      thresholds: {
        lines: 95,
        branches: 90,
        // Per-file thresholds: also apply the same floor file-by-file
        perFile: false,
      },
      // Don't fail the build while domain/ is nearly empty.
      // Once real domain files exist (issue #2+), remove this comment
      // and confirm the thresholds still pass on every PR.
      skipFull: false,
    },
  },
});
