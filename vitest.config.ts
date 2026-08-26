/**
 * @file Vitest configuration for the extension's DOM-aware unit and integration tests.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        restoreMocks: true,
        include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
    }
});
