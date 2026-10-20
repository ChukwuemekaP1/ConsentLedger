/**
 * Zod schemas for every response the Agent surface consumes.
 *
 * Browser input is untrusted in both directions: server responses are parsed,
 * never cast (AGENTS.md rule 8). A response that does not match is treated as a
 * failure, not as success (I-11).
 */

import { z } from "zod";
import { CartMandateTermsSchema } from "../../domain/mandate/types.js";

const AttestationSchema = z.object({
  role: z.enum(["AUTHORITY", "MERCHANT"]),
  keyId: z.string(),
  signature: z.string(),
});

export const ProposalResponseSchema = z.object({
  mandate: z.object({
    terms: CartMandateTermsSchema,
    hash: z.string().min(1),
    attestations: z.array(AttestationSchema),
    status: z.string(),
  }),
  proposal: z.object({ rationale: z.string() }).passthrough(),
  evaluation: z.object({
    decision: z.enum(["ALLOW", "DENY"]),
    reasons: z.array(z.string()),
  }),
});
export type ProposalResponse = z.infer<typeof ProposalResponseSchema>;

export const ProblemSchema = z
  .object({
    code: z.string().optional(),
    title: z.string().optional(),
    detail: z.string().optional(),
    status: z.number().optional(),
    reasons: z.array(z.string()).optional(),
  })
  .passthrough();
export type Problem = z.infer<typeof ProblemSchema>;

export const RegistrationResponseSchema = z.object({
  status: z.literal("ok"),
  principalId: z.string(),
  credentialId: z.string(),
});

export const ConsentVerifyResponseSchema = z.object({
  status: z.literal("ok"),
  mandateId: z.string(),
  mandateHash: z.string(),
  credentialId: z.string(),
  mandateStatus: z.string(),
  verifiedAt: z.string(),
});
export type ConsentVerifyResponse = z.infer<typeof ConsentVerifyResponseSchema>;

export const OrderResponseSchema = z.object({
  orderId: z.string().min(1),
  paymentMandateId: z.string(),
  status: z.string(),
});
export type OrderResponse = z.infer<typeof OrderResponseSchema>;

export const CaptureResponseSchema = z.object({
  orderId: z.string(),
  captureId: z.string().optional(),
  status: z.string(),
  alreadyCaptured: z.boolean().optional(),
});
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;

export const ClientConfigSchema = z.object({
  clientId: z.string(),
  currency: z.string(),
  environment: z.enum(["sandbox", "live"]),
  settlementMode: z.enum(["paypal", "simulated"]),
  catalogMode: z.enum(["channel3", "fixture"]),
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
