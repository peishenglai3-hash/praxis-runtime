const { join } = require("node:path");

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolved",
      severity: "error",
      from: { path: "^(packages|apps)/" },
      to: { couldNotResolve: true },
    },
    {
      name: "contracts-only-depends-on-itself",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { pathNot: "^packages/contracts/" },
    },
    {
      name: "domain-does-not-depend-on-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-use-runtime-boundary",
      severity: "error",
      from: { path: "^apps/" },
      to: {
        path: "^packages/",
        pathNot: "^packages/runtime/",
      },
    },
    {
      name: "store-does-not-depend-on-upstream",
      severity: "error",
      from: { path: "^packages/store/" },
      to: { path: "^packages/(state|residual|agents|runtime)/" },
    },
    {
      name: "residual-does-not-depend-on-reflection",
      severity: "error",
      from: { path: "^packages/residual/" },
      to: { path: "^packages/reflection/" },
    },
    {
      name: "reflection-does-not-depend-on-agents-or-store",
      severity: "error",
      from: { path: "^packages/reflection/" },
      to: { path: "^packages/(agents|store)/" },
    },
    {
      name: "assets-does-not-depend-on-agents-or-store",
      severity: "error",
      from: { path: "^packages/assets/" },
      to: { path: "^packages/(agents|store)/" },
    },
    {
      name: "context-does-not-depend-on-residual",
      severity: "error",
      from: { path: "^packages/context/" },
      to: { path: "^packages/residual/" },
    },
    {
      name: "core-does-not-depend-on-provider-sdks",
      severity: "error",
      from: {
        path: "^packages/(contracts|store|state|context|residual|reflection|assets|agents|runtime)/",
      },
      to: {
        path: "^node_modules/(openai|@anthropic-ai|@google/generative-ai|ollama|langchain|@langchain)/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    // Resolve workspace package imports to source entry points for graph analysis.
    // Runtime package exports still remain the source of truth for Node execution.
    tsConfig: {
      fileName: join(__dirname, "tsconfig.dependency-cruiser.json"),
    },
    exclude: ["node_modules", "dist", "coverage"],
  },
};
