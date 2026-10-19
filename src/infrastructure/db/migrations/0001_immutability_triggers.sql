-- Migration 0001: Immutability triggers and constraints for evidence ledger and payment mandates (I-03, I-04)

-- 1. Functions to block UPDATE and DELETE on immutable append-only tables
CREATE OR REPLACE FUNCTION block_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % operations are strictly forbidden on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- 2. Function to block TRUNCATE on immutable append-only tables
CREATE OR REPLACE FUNCTION block_ledger_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: TRUNCATE is strictly forbidden on %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- 3. Row-level triggers on ledger_events
CREATE TRIGGER ledger_events_block_mutation
  BEFORE UPDATE OR DELETE ON "ledger_events"
  FOR EACH ROW
  EXECUTE FUNCTION block_ledger_mutation();
--> statement-breakpoint

-- 4. Statement-level trigger on ledger_events for TRUNCATE
CREATE TRIGGER ledger_events_block_truncate
  BEFORE TRUNCATE ON "ledger_events"
  FOR EACH STATEMENT
  EXECUTE FUNCTION block_ledger_truncate();
--> statement-breakpoint

-- 5. Row-level triggers on ledger_checkpoints
CREATE TRIGGER ledger_checkpoints_block_mutation
  BEFORE UPDATE OR DELETE ON "ledger_checkpoints"
  FOR EACH ROW
  EXECUTE FUNCTION block_ledger_mutation();
--> statement-breakpoint

-- 6. Statement-level trigger on ledger_checkpoints for TRUNCATE
CREATE TRIGGER ledger_checkpoints_block_truncate
  BEFORE TRUNCATE ON "ledger_checkpoints"
  FOR EACH STATEMENT
  EXECUTE FUNCTION block_ledger_truncate();
--> statement-breakpoint

-- 7. Cart single-use constraint (I-03): A CART mandate allows sequence = 1 only
CREATE OR REPLACE FUNCTION enforce_cart_single_use()
RETURNS trigger AS $$
DECLARE
  v_kind varchar(16);
BEGIN
  SELECT kind INTO v_kind FROM "mandates" WHERE id = NEW.mandate_id;
  IF v_kind = 'CART' AND NEW.sequence <> 1 THEN
    RAISE EXCEPTION 'cart mandates allow sequence = 1 only (Invariant I-03 violation)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER payment_mandates_cart_single_use
  BEFORE INSERT OR UPDATE ON "payment_mandates"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_cart_single_use();