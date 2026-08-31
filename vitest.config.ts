import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@worldgraph/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@worldgraph/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@worldgraph/acquire": path.resolve(__dirname, "packages/acquire/src/index.ts"),
      "@worldgraph/extract": path.resolve(__dirname, "packages/extract/src/index.ts"),
      "@worldgraph/knowledge": path.resolve(__dirname, "packages/knowledge/src/index.ts"),
      "@worldgraph/plan": path.resolve(__dirname, "packages/plan/src/index.ts"),
    },
  },
});
