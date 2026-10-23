/**
 * Lab route guard.
 *
 * Security-lab endpoints execute adversarial scenarios. They exist only when
 * LAB_ENABLED is true; otherwise they answer 404 so the surface is not advertised.
 * INVARIANT I-11: fail closed.
 */

export function labDisabledResponse(): Response {
  return new Response(
    JSON.stringify({
      type: "https://consentledger.dev/problems/not-found",
      title: "Not Found",
      status: 404,
      detail: "The security lab is disabled on this deployment (LAB_ENABLED=false).",
      instance: "/api/v1/lab",
      code: "NOT_FOUND",
    }),
    {
      status: 404,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}
