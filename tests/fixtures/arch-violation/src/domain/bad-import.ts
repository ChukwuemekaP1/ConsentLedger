// FIXTURE — deliberate architecture violation.
// domain importing from infrastructure — this must NEVER exist in real src/.
// Used only by tests/unit/arch/arch-rules.test.ts to prove the rule fires.
import type {} from "../infrastructure/some-adapter.js";
