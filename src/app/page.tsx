/**
 * Placeholder home page — issue #1 foundation only.
 * Uses design tokens from docs/DESIGN.md.
 * No product features. Replaced in issue #11 (Ledger Console UI).
 */
import packageJson from "../../package.json" with { type: "json" };

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        backgroundColor: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        fontFamily: "sans-serif",
        padding: "2rem",
      }}
    >
      <h1
        style={{
          color: "var(--text)",
          fontSize: "28px",
          fontWeight: 600,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        ConsentLedger
      </h1>

      <p
        style={{
          color: "var(--text-dim)",
          fontSize: "16px",
          margin: 0,
          textAlign: "center",
          maxWidth: "480px",
        }}
      >
        Foundation. No product features yet.
      </p>

      <code
        style={{
          color: "var(--text-dim)",
          fontSize: "12px",
          fontFamily: "monospace",
          backgroundColor: "var(--panel)",
          padding: "4px 8px",
          borderRadius: "6px",
          border: "1px solid var(--line)",
        }}
      >
        v{packageJson.version}
      </code>
    </main>
  );
}
