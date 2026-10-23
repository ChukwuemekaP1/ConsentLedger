/**
 * Seed Script: seed-demo-sales.ts
 *
 * Seeds Neon PostgreSQL with:
 *   - Dedicated Executive Principal: Alex Vance (a11ce000-0000-4000-8000-000000000001)
 *   - Spending Policy ($100 per tx cap, $500 monthly budget)
 *   - Registered Biometric Passkey
 *   - 3 Real Completed Sales (Keychron Keyboard, Ethiopian Coffee, ErgoPlus Monitor Arm)
 *   - 1 Blocked Policy-Denied Attempt ($399 vs $100 cap)
 *
 * All events are hash-chained via appendToChain conforming to Invariants I-01, I-02, I-04, I-10, I-11.
 */

import { eq } from "drizzle-orm";
import { container } from "../src/container.js";
import { principals } from "../src/infrastructure/db/schema/principals.js";
import { agents } from "../src/infrastructure/db/schema/agents.js";
import { policies } from "../src/infrastructure/db/schema/policies.js";
import { passkeyCredentials } from "../src/infrastructure/db/schema/passkeys.js";
import { mandates } from "../src/infrastructure/db/schema/mandates.js";
import { paymentMandates } from "../src/infrastructure/db/schema/payment-mandates.js";
import { ledgerEvents } from "../src/infrastructure/db/schema/ledger-events.js";
import { buildCartMandate } from "../src/domain/mandate/builders.js";
import { appendToChain, type ChainHead } from "../src/domain/ledger/chain.js";
import { sha256Hex } from "../src/domain/crypto/hash.js";
import { canonicalize } from "../src/domain/crypto/canonical.js";
import type { Timestamp, Uuid } from "../src/domain/shared/clock.js";
import type { LedgerEventDraft } from "../src/domain/ledger/events.js";

const PRINCIPAL_ID = "a11ce000-0000-4000-8000-000000000001";
const AGENT_ID = "a9e47000-0000-4000-8000-000000000001";
const POLICY_ID = "policy-alex-vance-v1";
const PASSKEY_CREDENTIAL_ID = "c11ce000-0000-4000-8000-000000000001";

async function main() {
  const dbClient = container.getDbClient();
  if (!dbClient) {
    console.error("No DATABASE_URL configured!");
    process.exit(1);
  }
  const db = dbClient.db;

  console.log("Seeding dedicated executive persona and completed sales...");

  const nowIso = "2026-10-23T08:00:00.000Z";

  // 1. Upsert Principal: Alex Vance
  const existingPrincipals = await db
    .select()
    .from(principals)
    .where(eq(principals.id, PRINCIPAL_ID))
    .limit(1);

  if (existingPrincipals.length === 0) {
    await db.insert(principals).values({
      id: PRINCIPAL_ID,
      displayName: "Alex Vance",
      createdAt: nowIso,
    });
    console.log("✓ Created Principal: Alex Vance");
  } else {
    await db
      .update(principals)
      .set({ displayName: "Alex Vance" })
      .where(eq(principals.id, PRINCIPAL_ID));
    console.log("✓ Principal Alex Vance updated to official display name");
  }

  // 2. Upsert Agent: Gemini Shopping Agent
  const existingAgents = await db.select().from(agents).where(eq(agents.id, AGENT_ID)).limit(1);

  if (existingAgents.length === 0) {
    await db.insert(agents).values({
      id: AGENT_ID,
      name: "Gemini Shopping Agent",
      kind: "autonomous_procurement",
      apiKeyHash: sha256Hex("gemini-agent-api-key"),
      createdAt: nowIso,
    });
    console.log("✓ Created Agent: Gemini Shopping Agent");
  } else {
    console.log("✓ Agent already exists");
  }

  // 3. Upsert Policy ($100 per-transaction cap, $500 monthly)
  const policyContent = {
    rules: {
      maxPerTxMinor: 10000, // $100.00
      monthlyBudgetMinor: 50000, // $500.00
      currency: "USD",
    },
  };
  const policyCanonical = canonicalize(policyContent);
  const policyHash = sha256Hex(policyCanonical.ok ? policyCanonical.value : "");

  const existingPolicies = await db
    .select()
    .from(policies)
    .where(eq(policies.id, POLICY_ID))
    .limit(1);

  if (existingPolicies.length === 0) {
    await db.insert(policies).values({
      id: POLICY_ID,
      version: 1,
      content: policyContent,
      hash: policyHash,
      active: true,
      createdAt: nowIso,
    });
    console.log("✓ Created Spending Policy: $100.00 / tx cap");
  } else {
    console.log("✓ Spending Policy already exists");
  }

  // 4. Upsert Passkey Credential for Alex Vance
  const existingPasskeys = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.id, PASSKEY_CREDENTIAL_ID))
    .limit(1);

  if (existingPasskeys.length === 0) {
    await db.insert(passkeyCredentials).values({
      id: PASSKEY_CREDENTIAL_ID,
      principalId: PRINCIPAL_ID,
      credentialId: "credential-alex-vance-titan-01",
      publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElZ1y...",
      counter: 4,
      transports: ["internal"],
      createdAt: nowIso,
    });
    console.log("✓ Created Passkey Credential for Alex Vance");
  } else {
    console.log("✓ Passkey Credential already exists");
  }

  // 5. Seed 3 Completed Sales + 1 Blocked Sale
  const salesData = [
    {
      mandateId: "10000001-0000-4000-8000-000000000001" as Uuid,
      correlationId: "20000001-0000-4000-8000-000000000001" as Uuid,
      pmId: "30000001-0000-4000-8000-000000000001" as Uuid,
      sku: "SKU-KEYCHRON-Q1PRO",
      description: "Keychron Q1 Pro Custom Mechanical Keyboard (Wireless RGB, QMK/VIA)",
      amountMinor: 8500, // $85.00
      merchantId: "merchant-keychron-01",
      displayName: "Keychron Official / ShopX",
      paypalOrderId: "ORDER-KEYCHRON-8500",
      paypalCaptureId: "CAPTURE-KEYCHRON-8500",
      isCaptured: true,
      timestamp: "2026-10-23T08:10:00.000Z" as Timestamp,
    },
    {
      mandateId: "10000002-0000-4000-8000-000000000002" as Uuid,
      correlationId: "20000002-0000-4000-8000-000000000002" as Uuid,
      pmId: "30000002-0000-4000-8000-000000000002" as Uuid,
      sku: "SKU-COFFEE-YIRGACHEFFE",
      description: "Single-Origin Ethiopian Yirgacheffe Roast (2lb Whole Bean)",
      amountMinor: 2400, // $24.00
      merchantId: "merchant-addison-roasters",
      displayName: "Addison Specialty Roasters",
      paypalOrderId: "ORDER-COFFEE-2400",
      paypalCaptureId: "CAPTURE-COFFEE-2400",
      isCaptured: true,
      timestamp: "2026-10-23T08:25:00.000Z" as Timestamp,
    },
    {
      mandateId: "10000003-0000-4000-8000-000000000003" as Uuid,
      correlationId: "20000003-0000-4000-8000-000000000003" as Uuid,
      pmId: "30000003-0000-4000-8000-000000000003" as Uuid,
      sku: "SKU-MONITOR-ARM-DSG",
      description: 'Heavy-Duty Gas-Spring Dual Monitor Arm (Desk-Mount 32")',
      amountMinor: 6500, // $65.00
      merchantId: "merchant-ergoplus-workspace",
      displayName: "ErgoPlus Workspace",
      paypalOrderId: "ORDER-ERGOPLUS-6500",
      paypalCaptureId: "CAPTURE-ERGOPLUS-6500",
      isCaptured: true,
      timestamp: "2026-10-23T08:40:00.000Z" as Timestamp,
    },
    {
      mandateId: "10000004-0000-4000-8000-000000000004" as Uuid,
      correlationId: "20000004-0000-4000-8000-000000000004" as Uuid,
      pmId: "30000004-0000-4000-8000-000000000004" as Uuid,
      sku: "SKU-STUDIO-AUDIO-PRO",
      description: "Studio Master Reference Audio Setup",
      amountMinor: 39900, // $399.00 (Exceeds $100 cap)
      merchantId: "merchant-audiophile",
      displayName: "AudioPhile Direct",
      paypalOrderId: "ORDER-AUDIO-39900",
      paypalCaptureId: undefined,
      isCaptured: false,
      timestamp: "2026-10-23T08:50:00.000Z" as Timestamp,
    },
  ];

  for (const sale of salesData) {
    const existingMandate = await db
      .select()
      .from(mandates)
      .where(eq(mandates.id, sale.mandateId))
      .limit(1);

    if (existingMandate.length > 0) {
      console.log(`✓ Mandate ${sale.mandateId} already exists, skipping.`);
      continue;
    }

    // Calculate validity window with 10-minute TTL per Invariant I-02
    const notBeforeMs = new Date(sale.timestamp).getTime();
    const expiresAtMs = notBeforeMs + 10 * 60 * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString() as Timestamp;

    // Build Cart Mandate
    const mandateResult = buildCartMandate({
      id: sale.mandateId,
      correlationId: sale.correlationId,
      principalId: PRINCIPAL_ID,
      agent: { id: AGENT_ID, model: "gemini-3.5-flash" },
      payee: { merchantId: sale.merchantId, displayName: sale.displayName },
      payment: { amountMinor: sale.amountMinor, currency: "USD" },
      items: [
        {
          sku: sale.sku,
          description: sale.description,
          quantity: 1,
          unitAmountMinor: sale.amountMinor,
        },
      ],
      promptPlayback: `Order ${sale.description}`,
      policy: { id: POLICY_ID, hash: policyHash },
      validity: {
        notBefore: sale.timestamp,
        expiresAt,
      },
      nonce: `nonce-${sale.mandateId.slice(0, 8)}`,
    });

    if (!mandateResult.ok) {
      console.error("Failed to build mandate:", mandateResult.error);
      continue;
    }

    const { terms, hash: termsHash } = mandateResult.value;

    // Insert Mandate
    await db.insert(mandates).values({
      id: sale.mandateId,
      kind: "CART",
      correlationId: sale.correlationId,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      terms,
      hash: termsHash,
      status: sale.isCaptured ? "FULFILLED" : "FAILED",
      expiresAt,
      createdAt: sale.timestamp,
    });

    // Insert Payment Mandate
    await db.insert(paymentMandates).values({
      id: sale.pmId,
      mandateId: sale.mandateId,
      correlationId: sale.correlationId,
      sequence: 1,
      terms: { amountMinor: sale.amountMinor, currency: "USD" },
      hash: sha256Hex(`pm-hash-${sale.pmId}`),
      authoritySignature: "ed25519-sig-mock",
      status: sale.isCaptured ? "CAPTURED" : "FAILED",
      requestId: `40000000-${sale.mandateId.slice(9)}` as Uuid,
      captureRequestId: sale.isCaptured ? (`50000000-${sale.mandateId.slice(9)}` as Uuid) : null,
      paypalOrderId: sale.paypalOrderId,
      paypalCaptureId: sale.paypalCaptureId ?? null,
      createdAt: sale.timestamp,
    });

    // Build Cryptographic Ledger Events Chain
    let head: ChainHead | null = null;

    // Event 1: MANDATE_ISSUED
    const draft1: LedgerEventDraft = {
      correlationId: sale.correlationId,
      type: "MANDATE_ISSUED",
      actor: { type: "agent", id: AGENT_ID },
      payload: { terms, mandateId: sale.mandateId },
    };
    const ev1Result = appendToChain(
      head,
      draft1,
      `60000001-${sale.mandateId.slice(9)}` as Uuid,
      sale.timestamp,
    );
    if (!ev1Result.ok) throw new Error(ev1Result.error.message);
    const ev1 = ev1Result.value;
    head = { seq: ev1.seq, hash: ev1.hash };

    await db.insert(ledgerEvents).values({
      correlationId: ev1.correlationId,
      seq: ev1.seq,
      id: ev1.id,
      type: ev1.type,
      actorType: ev1.actor.type,
      actorId: ev1.actor.id,
      payload: ev1.payload,
      prevHash: ev1.prevHash,
      hash: ev1.hash,
      createdAt: ev1.createdAt,
    });

    if (sale.isCaptured) {
      // Event 2: CONSENT_RECORDED
      const draft2: LedgerEventDraft = {
        correlationId: sale.correlationId,
        type: "CONSENT_RECORDED",
        actor: { type: "principal", id: PRINCIPAL_ID },
        payload: {
          mandateId: sale.mandateId,
          termsHash,
          passkeyVerified: true,
          credentialId: "credential-alex-vance-titan-01",
        },
      };
      const ev2Result = appendToChain(
        head,
        draft2,
        `60000002-${sale.mandateId.slice(9)}` as Uuid,
        sale.timestamp,
      );
      if (!ev2Result.ok) throw new Error(ev2Result.error.message);
      const ev2 = ev2Result.value;
      head = { seq: ev2.seq, hash: ev2.hash };

      await db.insert(ledgerEvents).values({
        correlationId: ev2.correlationId,
        seq: ev2.seq,
        id: ev2.id,
        type: ev2.type,
        actorType: ev2.actor.type,
        actorId: ev2.actor.id,
        payload: ev2.payload,
        prevHash: ev2.prevHash,
        hash: ev2.hash,
        createdAt: ev2.createdAt,
      });

      // Event 3: PAYPAL_ORDER_CREATED
      const draft3: LedgerEventDraft = {
        correlationId: sale.correlationId,
        type: "PAYPAL_ORDER_CREATED",
        actor: { type: "provider", id: "paypal-client" },
        payload: {
          paymentMandateId: sale.pmId,
          paypalOrderId: sale.paypalOrderId,
          amountMinor: sale.amountMinor,
          currency: "USD",
        },
      };
      const ev3Result = appendToChain(
        head,
        draft3,
        `60000003-${sale.mandateId.slice(9)}` as Uuid,
        sale.timestamp,
      );
      if (!ev3Result.ok) throw new Error(ev3Result.error.message);
      const ev3 = ev3Result.value;
      head = { seq: ev3.seq, hash: ev3.hash };

      await db.insert(ledgerEvents).values({
        correlationId: ev3.correlationId,
        seq: ev3.seq,
        id: ev3.id,
        type: ev3.type,
        actorType: ev3.actor.type,
        actorId: ev3.actor.id,
        payload: ev3.payload,
        prevHash: ev3.prevHash,
        hash: ev3.hash,
        createdAt: ev3.createdAt,
      });

      // Event 4: CAPTURE_COMPLETED
      const draft4: LedgerEventDraft = {
        correlationId: sale.correlationId,
        type: "CAPTURE_COMPLETED",
        actor: { type: "provider", id: "paypal-client" },
        payload: {
          paymentMandateId: sale.pmId,
          paypalCaptureId: sale.paypalCaptureId,
          status: "COMPLETED",
          amountMinor: sale.amountMinor,
          currency: "USD",
        },
      };
      const ev4Result = appendToChain(
        head,
        draft4,
        `60000004-${sale.mandateId.slice(9)}` as Uuid,
        sale.timestamp,
      );
      if (!ev4Result.ok) throw new Error(ev4Result.error.message);
      const ev4 = ev4Result.value;

      await db.insert(ledgerEvents).values({
        correlationId: ev4.correlationId,
        seq: ev4.seq,
        id: ev4.id,
        type: ev4.type,
        actorType: ev4.actor.type,
        actorId: ev4.actor.id,
        payload: ev4.payload,
        prevHash: ev4.prevHash,
        hash: ev4.hash,
        createdAt: ev4.createdAt,
      });

      console.log(
        `✓ Seeded Captured Sale: ${sale.description} ($${(sale.amountMinor / 100).toFixed(2)})`,
      );
    } else {
      // Blocked Policy Denial: Event 2: POLICY_DENIED
      const draft2: LedgerEventDraft = {
        correlationId: sale.correlationId,
        type: "POLICY_DENIED",
        actor: { type: "system", id: "spending-policy-gate" },
        payload: {
          reason: "AMOUNT_EXCEEDS_CAP",
          attemptedAmountMinor: sale.amountMinor,
          maxPerTxMinor: 10000,
          currency: "USD",
        },
      };
      const ev2Result = appendToChain(
        head,
        draft2,
        `60000002-${sale.mandateId.slice(9)}` as Uuid,
        sale.timestamp,
      );
      if (!ev2Result.ok) throw new Error(ev2Result.error.message);
      const ev2 = ev2Result.value;

      await db.insert(ledgerEvents).values({
        correlationId: ev2.correlationId,
        seq: ev2.seq,
        id: ev2.id,
        type: ev2.type,
        actorType: ev2.actor.type,
        actorId: ev2.actor.id,
        payload: ev2.payload,
        prevHash: ev2.prevHash,
        hash: ev2.hash,
        createdAt: ev2.createdAt,
      });

      console.log(
        `✓ Seeded Blocked Attempt: ${sale.description} ($${(sale.amountMinor / 100).toFixed(2)})`,
      );
    }
  }

  console.log("Seeding complete! 3 captured purchases + 1 blocked attempt are now authoritative.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed with error:", err);
  process.exit(1);
});
