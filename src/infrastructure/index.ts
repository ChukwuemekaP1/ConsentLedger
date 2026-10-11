// Layer: infrastructure
// Rule: may import application/ports and domain. Must not import interface, app, or ui.
// This is the only layer that reads env, does I/O, and constructs adapters.
// container.ts is the only file that wires adapters to use cases.
