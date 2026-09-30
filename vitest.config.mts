import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same "@/*" alias as tsconfig.json, so tests can import app modules.
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
