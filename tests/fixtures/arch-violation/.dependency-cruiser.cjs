// @ts-check
// Fixture-specific dep-cruiser config — mirrors the real rules but uses
// path-agnostic patterns that match wherever the fixture is cruised from.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-outside-allowlist",
      severity: "error",
      from: {
        // Match any path that has /domain/ in it
        path: "domain",
      },
      to: {
        // Deny any import that goes to /infrastructure/
        path: "infrastructure",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
