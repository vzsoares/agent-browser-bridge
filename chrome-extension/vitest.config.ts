import { defineConfig } from "vitest/config";

/**
 * Chrome extension test configuration.
 *
 * Uses happy-dom to simulate browser DOM APIs without a real browser.
 * Tests run against the domain, application, and infrastructure layers.
 */
export default defineConfig({
  test: {
    // Simulate browser DOM (document, window, querySelector, etc.)
    environment: "happy-dom",

    // Setup file runs before each test suite
    setupFiles: ["./src/__tests__/vitest.setup.ts"],

    // Test file patterns
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],

    // Exclude e2e tests (they use real Chrome, not happy-dom)
    exclude: ["**/e2e/**", "**/e2e.test.ts"],

    // Globals so we don't need explicit imports in tests
    globals: true,
  },
});
