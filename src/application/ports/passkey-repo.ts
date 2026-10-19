/**
 * Passkey and challenge repository port.
 *
 * Defines persistence operations for passkeys, principals, and temporary WebAuthn challenges.
 * ARCHITECTURE.md §12.
 */

export interface StoredPasskeyCredential {
  readonly id: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports?: string[] | undefined;
  readonly aaguid?: string | undefined;
  readonly createdAt: string;
}

export interface StoredWebAuthnChallenge {
  readonly id: string;
  readonly challenge: string;
  readonly purpose: "registration" | "authentication" | "consent";
  readonly principalId?: string | undefined;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface StoredPrincipal {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: string;
}

export interface PasskeyRepo {
  // Principal operations
  findPrincipalById(id: string): Promise<StoredPrincipal | null>;
  createPrincipal(principal: {
    id: string;
    displayName: string;
    createdAt: string;
  }): Promise<StoredPrincipal>;

  // Challenge operations
  saveChallenge(challenge: {
    id: string;
    challenge: string;
    purpose: "registration" | "authentication" | "consent";
    principalId?: string | undefined;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredWebAuthnChallenge>;

  findAndConsumeChallenge(challenge: string): Promise<StoredWebAuthnChallenge | null>;

  // Credential operations
  findCredentialByCredentialId(credentialId: string): Promise<StoredPasskeyCredential | null>;
  listCredentialsByPrincipalId(principalId: string): Promise<StoredPasskeyCredential[]>;
  saveCredential(credential: {
    id: string;
    principalId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[] | undefined;
    aaguid?: string | undefined;
    createdAt: string;
  }): Promise<StoredPasskeyCredential>;
}
