import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@praxis/contracts": resolve(
        import.meta.dirname,
        "packages/contracts/src/index.ts",
      ),
    },
  },
});
