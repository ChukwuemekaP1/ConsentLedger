/**
 * Postgres implementation of PasskeyRepo.
 *
 * Persists principals, WebAuthn challenges, and passkey credentials.
 * ARCHITECTURE.md §12.
 */

import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { principals } from "../schema/principals.js";
import { passkeyCredentials, webauthnChallenges } from "../schema/passkeys.js";
import type {
  PasskeyRepo,
  StoredPasskeyCredential,
  StoredWebAuthnChallenge,
  StoredPrincipal,
} from "../../../application/ports/passkey-repo.js";

export class PostgresPasskeyRepo implements PasskeyRepo {
  constructor(private readonly db: Database) {}

  async findPrincipalById(id: string): Promise<StoredPrincipal | null> {
    const rows = await this.db.select().from(principals).where(eq(principals.id, id)).limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      displayName: row.displayName,
      createdAt: row.createdAt,
    };
  }

  async createPrincipal(principal: {
    id: string;
    displayName: string;
    createdAt: string;
  }): Promise<StoredPrincipal> {
    const rows = await this.db
      .insert(principals)
      .values({
        id: principal.id,
        displayName: principal.displayName,
        createdAt: principal.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert principal: no row returned");
    }

    return {
      id: row.id,
      displayName: row.displayName,
      createdAt: row.createdAt,
    };
  }

  async saveChallenge(challenge: {
    id: string;
    challenge: string;
    purpose: "registration" | "authentication" | "consent";
    principalId?: string | undefined;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredWebAuthnChallenge> {
    const rows = await this.db
      .insert(webauthnChallenges)
      .values({
        id: challenge.id,
        challenge: challenge.challenge,
        purpose: challenge.purpose,
        principalId: challenge.principalId,
        expiresAt: challenge.expiresAt,
        createdAt: challenge.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert webauthn challenge: no row returned");
    }

    const result: StoredWebAuthnChallenge = {
      id: row.id,
      challenge: row.challenge,
      purpose: row.purpose as "registration" | "authentication" | "consent",
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      ...(row.principalId ? { principalId: row.principalId } : {}),
    };

    return result;
  }

  async findAndConsumeChallenge(challenge: string): Promise<StoredWebAuthnChallenge | null> {
    // Delete and return to guarantee single-use consumption atomically
    const rows = await this.db
      .delete(webauthnChallenges)
      .where(eq(webauthnChallenges.challenge, challenge))
      .returning();

    const row = rows[0];
    if (!row) return null;

    const result: StoredWebAuthnChallenge = {
      id: row.id,
      challenge: row.challenge,
      purpose: row.purpose as "registration" | "authentication" | "consent",
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      ...(row.principalId ? { principalId: row.principalId } : {}),
    };

    return result;
  }

  async findCredentialByCredentialId(
    credentialId: string,
  ): Promise<StoredPasskeyCredential | null> {
    const rows = await this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, credentialId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const result: StoredPasskeyCredential = {
      id: row.id,
      principalId: row.principalId,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      counter: Number(row.counter),
      createdAt: row.createdAt,
      ...(row.transports ? { transports: row.transports as string[] } : {}),
      ...(row.aaguid ? { aaguid: row.aaguid } : {}),
    };

    return result;
  }

  async listCredentialsByPrincipalId(principalId: string): Promise<StoredPasskeyCredential[]> {
    const rows = await this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.principalId, principalId));

    return rows.map((row) => ({
      id: row.id,
      principalId: row.principalId,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      counter: Number(row.counter),
      createdAt: row.createdAt,
      ...(row.transports ? { transports: row.transports as string[] } : {}),
      ...(row.aaguid ? { aaguid: row.aaguid } : {}),
    }));
  }

  async saveCredential(credential: {
    id: string;
    principalId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[] | undefined;
    aaguid?: string | undefined;
    createdAt: string;
  }): Promise<StoredPasskeyCredential> {
    const rows = await this.db
      .insert(passkeyCredentials)
      .values({
        id: credential.id,
        principalId: credential.principalId,
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
        aaguid: credential.aaguid,
        createdAt: credential.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert passkey credential: no row returned");
    }

    const result: StoredPasskeyCredential = {
      id: row.id,
      principalId: row.principalId,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      counter: Number(row.counter),
      createdAt: row.createdAt,
      ...(row.transports ? { transports: row.transports as string[] } : {}),
      ...(row.aaguid ? { aaguid: row.aaguid } : {}),
    };

    return result;
  }
}
