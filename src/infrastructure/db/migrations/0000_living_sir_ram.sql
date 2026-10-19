CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"api_key_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"hash" char(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "policies_id_version_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "policies_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"terms" jsonb NOT NULL,
	"hash" char(64) NOT NULL,
	"attestations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mandates_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"mandate_id" uuid PRIMARY KEY NOT NULL,
	"total_minor" bigint NOT NULL,
	"spent_minor" bigint DEFAULT 0 NOT NULL,
	"reserved_minor" bigint DEFAULT 0 NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"max_transactions" integer NOT NULL,
	"per_tx_max_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "budget_total_non_negative" CHECK ("budgets"."total_minor" >= 0),
	CONSTRAINT "budget_spent_non_negative" CHECK ("budgets"."spent_minor" >= 0),
	CONSTRAINT "budget_reserved_non_negative" CHECK ("budgets"."reserved_minor" >= 0),
	CONSTRAINT "budget_limit_check" CHECK ("budgets"."spent_minor" + "budgets"."reserved_minor" <= "budgets"."total_minor")
);
--> statement-breakpoint
CREATE TABLE "payment_mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"terms" jsonb NOT NULL,
	"hash" char(64) NOT NULL,
	"authority_signature" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"request_id" uuid NOT NULL,
	"capture_request_id" uuid,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_mandates_hash_unique" UNIQUE("hash"),
	CONSTRAINT "payment_mandates_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "payment_mandates_capture_request_id_unique" UNIQUE("capture_request_id"),
	CONSTRAINT "payment_mandates_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "payment_mandates_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "payment_mandates_mandate_seq_idx" UNIQUE("mandate_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"correlation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" char(64) NOT NULL,
	"hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_events_correlation_id_seq_pk" PRIMARY KEY("correlation_id","seq"),
	CONSTRAINT "ledger_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "ledger_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"size" integer NOT NULL,
	"root" char(64) NOT NULL,
	"signature" text NOT NULL,
	"key_id" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"paypal_event_id" varchar(128) PRIMARY KEY NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"resource_status" varchar(64),
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD CONSTRAINT "payment_mandates_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policies_active_idx" ON "policies" USING btree ("active");--> statement-breakpoint
CREATE INDEX "mandates_correlation_id_idx" ON "mandates" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "mandates_principal_status_idx" ON "mandates" USING btree ("principal_id","status");--> statement-breakpoint
CREATE INDEX "payment_mandates_correlation_id_idx" ON "payment_mandates" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "ledger_events_type_idx" ON "ledger_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ledger_events_created_at_idx" ON "ledger_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_checkpoints_created_at_idx" ON "ledger_checkpoints" USING btree ("created_at");