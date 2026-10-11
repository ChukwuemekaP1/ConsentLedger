// @ts-check
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ─── domain: allowlist (must not import anything outside this list) ─────────
    // Why an allowlist, not a denylist: new dependencies are denied by default.
    // Adding a domain import requires a deliberate PR edit here — not an accident.
    // Allowed: domain itself, node:crypto (hashing only), zod (schema validation).
    // To extend: open a PR with an ADR explaining why the import is safe in pure domain code.
    {
      name: "domain-outside-allowlist",
      comment:
        "domain may only import domain, node:crypto, and zod. " +
        "Extending the allowlist requires an ADR.",
      severity: "error",
      from: { path: "^src/domain" },
      to: {
        pathNot: [
          "^src/domain",
          "^node:crypto$",
          // zod — schema validation is pure (no I/O) and essential for domain types
          "^zod",
        ],
        // Don't flag Node built-ins other than the explicit ones above
        dependencyTypesNot: ["npm-dev", "npm-optional", "npm-peer"],
        pathNot: [
          "^src/domain",
          "^node:crypto$",
          "^zod",
          // node built-ins beyond node:crypto are caught by the explicit pattern above;
          // we also allow type-only imports from node built-ins (e.g. node:util types)
          "^node:",
        ],
      },
    },

    // ─── application: may only import domain ────────────────────────────────────
    {
      name: "application-imports-infrastructure",
      comment: "application must not import infrastructure, interface, app, or ui.",
      severity: "error",
      from: { path: "^src/application" },
      to: {
        path: "^src/(infrastructure|interface|app|ui)",
      },
    },

    // ─── infrastructure: must not import interface, app, or ui ──────────────────
    {
      name: "infrastructure-imports-interface",
      comment:
        "infrastructure must not import interface, app, or ui. " +
        "It may import application/ports and domain.",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: {
        path: "^src/(interface|app|ui)",
      },
    },

    // ─── interface: must not import infrastructure directly ──────────────────────
    // Infrastructure adapters are injected via container.ts (the composition root).
    {
      name: "interface-imports-infrastructure",
      comment:
        "interface must not import infrastructure directly. " +
        "Adapters are injected through container.ts.",
      severity: "error",
      from: { path: "^src/interface" },
      to: {
        path: "^src/infrastructure",
      },
    },

    // ─── app & ui: must not import infrastructure or config secrets ─────────────
    {
      name: "app-imports-infrastructure",
      comment: "app and ui must not import infrastructure. Use interface or application types.",
      severity: "error",
      from: { path: "^src/(app|ui)" },
      to: {
        path: "^src/infrastructure",
      },
    },

    // ─── agent code: infrastructure/llm and interface/mcp ───────────────────────
    // Agent code may only use ports named for propose, catalog, and status.
    // It must never reach the settlement port, signing code, or config secrets.
    // Issue #5 will fill in concrete port paths. This placeholder rule reserves
    // the constraint so violations are caught from the first file created there.
    //
    // Current allowed ports (expand when issue #5 defines them):
    //   src/application/ports/propose-port.ts
    //   src/application/ports/catalog-port.ts
    //   src/application/ports/status-port.ts
    {
      name: "agent-code-imports-settlement-port",
      comment:
        "Agent code (infrastructure/llm, interface/mcp) must not import the settlement port, " +
        "signing code, or config. It may only use propose, catalog, and status ports (I-07, ADR-0004).",
      severity: "error",
      from: { path: "^src/(infrastructure/llm|interface/mcp)" },
      to: {
        // Deny any application port that is NOT a propose/catalog/status port
        path: "^src/application/ports",
        pathNot: ["^src/application/ports/(propose|catalog|status)"],
      },
    },
    {
      name: "agent-code-imports-config-secrets",
      comment: "Agent code must never import config or signing infrastructure directly.",
      severity: "error",
      from: { path: "^src/(infrastructure/llm|interface/mcp)" },
      to: {
        path: "^src/infrastructure/(config|paypal|webauthn)",
      },
    },

    // ─── No circular dependencies anywhere ──────────────────────────────────────
    {
      name: "no-circular",
      comment: "Circular dependencies are forbidden.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
