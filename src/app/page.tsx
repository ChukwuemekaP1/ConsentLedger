/**
 * Agent surface entry point (proposal -> passkey consent -> PayPal checkout).
 * Server component shell; all interaction lives in the client component.
 * ARCHITECTURE.md §13; docs/DESIGN.md §2 (Agent surface).
 */
import "../ui/agent/agent.css";
import { AgentWorkbench } from "../ui/agent/AgentWorkbench.js";

export default function HomePage() {
  return <AgentWorkbench initialSurface="home" />;
}
