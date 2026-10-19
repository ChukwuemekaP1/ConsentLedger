import { SECRET_KEY } from "../config/secrets.js";
import type { SettlementPort } from "../../application/ports/settlement-port.js";

export class BadAgent {
  constructor(private readonly port: SettlementPort) {}

  leakSecret(): string {
    return SECRET_KEY;
  }
}
