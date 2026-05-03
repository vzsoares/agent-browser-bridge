import { defineConfig } from "vitest/config";

/**
 * Root-level Vitest configuration for the monorepo.
 *
 * Uses the `test.projects` feature (Vitest 4+) to scope test runs
 * to specific packages. Each listed project has its own vitest.config.ts
 * with per-package environment, setup files, and test patterns.
 *
 * Packages using bun:test (pi-extension, protocol) are excluded
 * from Vitest scanning by not being listed in `projects`.
 *
 * **CI exclusion**: The pi-extension e2e.test.ts is a manual pre-merge
 * gate that requires a running WebSocket server and simulated browser
 * clients. It is NOT run in CI — see the test file for details.
 *
 * @see https://vitest.dev/guide/projects.html
 */
export default defineConfig({
  test: {
    // Only Vitest-managed packages. bun:test packages (pi-extension,
    // protocol) are not listed here to avoid conflicts.
    projects: ["./chrome-extension"],

    // Shared globals — individual projects can override
    globals: true,

    // Safe defaults for exclude patterns.
    // e2e tests are explicitly excluded — they are manual pre-merge gates.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e.test.ts",
      "**/e2e/**",
    ],
  },
});
