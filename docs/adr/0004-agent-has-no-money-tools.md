# ADR-0004: The agent has no money tools; PayPal Agent Toolkit is not used for execution

Status: Accepted · Date: 2026-10-09

## Context
PayPal's Agent Toolkit hands payment operations (create order, invoices, subscriptions, and so on) to the LLM as tools. That is convenient, and it is the opposite of our thesis: a prompt-injected model with payment tools can act.

## Decision
The agent has exactly two tools: `search_catalog` and `propose_cart` (and over MCP: `propose`, `status`). PayPal calls happen only in the gateway, behind the Gate, using a typed adapter built on the official server SDK (or `fetch` if the SDK cannot take our idempotency IDs). The Agent Toolkit is not used for execution. It may be used read-only in the Operator later, if it earns its place.

## Consequences
+ A fully hijacked agent cannot move money (I-07).
+ Clean story for judges: PayPal is the settlement rail, not the agent's toolbox.
− We write the adapter ourselves instead of using prebuilt tools.

## Alternatives considered
- Agent Toolkit with an approval step in the UI: the approval is then a UI convention, not a cryptographic gate.
- MCP PayPal server given to the agent: same issue.
