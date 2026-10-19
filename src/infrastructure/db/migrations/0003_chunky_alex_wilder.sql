CREATE TABLE "mandate_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"authenticator_data" text NOT NULL,
	"client_data_json" text NOT NULL,
	"signature" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mandate_consents_mandate_id_unique" UNIQUE("mandate_id")
);
--> statement-breakpoint
ALTER TABLE "mandate_consents" ADD CONSTRAINT "mandate_consents_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_consents" ADD CONSTRAINT "mandate_consents_credential_id_passkey_credentials_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."passkey_credentials"("credential_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandate_consents_credential_id_idx" ON "mandate_consents" USING btree ("credential_id");