/**
 * Webhook repository port.
 *
 * Persists raw PayPal webhook event IDs for idempotency and replay protection (I-06).
 * ARCHITECTURE.md §9, §12
 */

export interface WebhookDeliveryRecord {
  readonly paypalEventId: string;
  readonly eventType: string;
  readonly resourceId: string;
  readonly resourceStatus?: string | null;
  readonly receivedAt: string;
}

export interface WebhookRepo {
  /**
   * Find an existing webhook delivery by PayPal's unique event ID.
   */
  findDeliveryById(paypalEventId: string): Promise<WebhookDeliveryRecord | null>;

  /**
   * Record a verified webhook delivery.
   */
  recordDelivery(delivery: WebhookDeliveryRecord): Promise<void>;
}
