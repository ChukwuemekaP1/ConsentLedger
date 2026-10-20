/**
 * Postgres implementation of WebhookRepo.
 *
 * Persists raw PayPal webhook event records for idempotency (I-06).
 * ARCHITECTURE.md §9, §12.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import type {
  WebhookRepo,
  WebhookDeliveryRecord,
} from "../../../application/ports/webhook-repo.js";
import { webhookDeliveries } from "../schema/webhooks.js";

export class PostgresWebhookRepo implements WebhookRepo {
  constructor(private readonly db: Database) {}

  async findDeliveryById(paypalEventId: string): Promise<WebhookDeliveryRecord | null> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.paypalEventId, paypalEventId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      paypalEventId: row.paypalEventId,
      eventType: row.eventType,
      resourceId: row.resourceId,
      resourceStatus: row.resourceStatus,
      receivedAt: row.receivedAt,
    };
  }

  async recordDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      paypalEventId: delivery.paypalEventId,
      eventType: delivery.eventType,
      resourceId: delivery.resourceId,
      resourceStatus: delivery.resourceStatus ?? null,
      receivedAt: delivery.receivedAt,
    });
  }
}
