# ADR-0007: Sponsor tools are optional and sit behind ports

Status: Accepted (updated 2026-10-10) · Date: 2026-10-09

## Context
The hackathon lists optional sponsor tools. Using one only to chase a prize risks a worse product and a worse UI. The rules cap a project at one main prize plus one sponsor prize, so breadth of sponsor use does not stack.

## Decision
Adopt a tool only if it improves the product or the engineering, and put it behind a port.
- **Render** and **Neon**: hosting and Postgres. Free, practical.
- **AG Grid Community**: the audit table is a grid problem. Themed to our design tokens.
- **Channel3**: real product data behind a `ProductCatalog` port. Removes the fake catalog. The call must be genuine and central to the agent's search.
- **APIMatic**: a contract-first OpenAPI 3.1 spec for our gateway, a generated typed SDK and docs portal. The Context Plugin may also help build the PayPal integration during development. It is not a runtime dependency.
- **Postgres** answers every query we need, so **Elastic is not used**. It can be added behind a `LedgerSearch` port if semantic search proves valuable.
- **AG Studio, Astropods, Bryntum, Kernel, Zapier, Postman as a deliverable**: not used.

## Consequences
+ A coherent product, not a sponsor collage.
+ Two cheap integrations (Channel3, APIMatic) that make the product more real and more developer-friendly.
− Several sponsor prizes are forgone. Accepted.

## Alternatives considered
- Integrate many sponsors shallowly: worse for "Technological Implementation" and "Design".
- Ignore all sponsors: loses two genuinely useful integrations.
