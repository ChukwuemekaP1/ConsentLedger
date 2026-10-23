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

/**
 * Display-only product facts (never signed). Image and store URLs come from an
 * untrusted catalog, so only https URLs are accepted (TB6); anything else drops the field.
 */
const HttpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "must be https");

export const ProductViewSchema = z.object({
  sku: z.string(),
  title: z.string(),
  merchantDisplayName: z.string(),
  imageUrl: HttpsUrl.optional().catch(undefined),
  buyUrl: HttpsUrl.optional().catch(undefined),
  brand: z.string().optional(),
});
export type ProductView = z.infer<typeof ProductViewSchema>;

export const SearchResultProductSchema = z.object({
  id: z.string().optional(),
  sku: z.string(),
  title: z.string(),
  description: z.string().optional().default(""),
  merchantId: z.string().optional().default(""),
  merchantDisplayName: z.string(),
  priceMinor: z.number().int(),
  currency: z.string().optional().default("USD"),
  imageUrl: HttpsUrl.optional().catch(undefined),
  buyUrl: HttpsUrl.optional().catch(undefined),
  brand: z.string().optional(),
  source: z.string().optional(),
});
export type SearchResultProduct = z.infer<typeof SearchResultProductSchema>;

export const ProductSearchResponseSchema = z.object({
  query: z.string(),
  count: z.number().int(),
  products: z.array(SearchResultProductSchema),
});
export type ProductSearchResponse = z.infer<typeof ProductSearchResponseSchema>;

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
  products: z.array(ProductViewSchema).optional().default([]),
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
