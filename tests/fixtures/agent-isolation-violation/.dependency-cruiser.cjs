// @ts-check
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "agent-code-imports-settlement-port",
      severity: "error",
      from: { path: "infrastructure/llm" },
      to: {
        path: "application/ports",
        pathNot: ["application/ports/(propose|catalog|status)"],
      },
    },
    {
      name: "agent-code-imports-config-secrets",
      severity: "error",
      from: { path: "infrastructure/llm" },
      to: {
        path: "infrastructure/(config|paypal|webauthn)",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
