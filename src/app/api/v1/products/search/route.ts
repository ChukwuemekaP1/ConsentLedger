/**
 * GET /api/v1/products/search
 * POST /api/v1/products/search
 *
 * Decoupled product discovery using the configured catalog (Channel3 API).
 * Enables autonomous item discovery with rich merchant inventory details
 * without upfront payment lock or mandate creation.
 *
 * ARCHITECTURE.md §14, Issue #17.
 */

import { z } from "zod";
import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import { toProblemResponse, fromAppError } from "../../../../../interface/http/problem.js";

const SearchQuerySchema = z.object({
  query: z.string().min(1, "Search query is required").max(300),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const rawQuery = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
  const rawLimit = url.searchParams.get("limit");

  const parsed = SearchQuerySchema.safeParse({
    query: rawQuery,
    ...(rawLimit !== null ? { limit: rawLimit } : {}),
  });

  if (!parsed.success) {
    return toProblemResponse(
      fromAppError(
        {
          code: "VALIDATION_FAILED",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
        url.pathname,
      ),
    );
  }

  try {
    const products = await container.getCatalog().search(parsed.data.query, {
      limit: parsed.data.limit,
    });

    return Response.json(
      {
        query: parsed.data.query,
        count: products.length,
        products,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch (err) {
    container.logger.error({ err, query: parsed.data.query }, "Product catalog search failed");
    return Response.json(
      {
        query: parsed.data.query,
        count: 0,
        products: [],
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toProblemResponse(
      fromAppError(
        {
          code: "VALIDATION_FAILED",
          message: "Request body must be valid JSON",
        },
        url.pathname,
      ),
    );
  }

  const parsed = SearchQuerySchema.safeParse(body);
  if (!parsed.success) {
    return toProblemResponse(
      fromAppError(
        {
          code: "VALIDATION_FAILED",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
        url.pathname,
      ),
    );
  }

  try {
    const products = await container.getCatalog().search(parsed.data.query, {
      limit: parsed.data.limit,
    });

    return Response.json(
      {
        query: parsed.data.query,
        count: products.length,
        products,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch (err) {
    container.logger.error({ err, query: parsed.data.query }, "Product catalog search failed");
    return Response.json(
      {
        query: parsed.data.query,
        count: 0,
        products: [],
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  }
}
