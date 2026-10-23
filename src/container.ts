/**
 * Composition root — the ONLY place that wires adapters to use cases.
 *
 * Rules:
 *   - This file may import infrastructure (it is the wiring point).
 *   - No other file outside infrastructure/ may import infrastructure directly.
 *   - Use cases and route handlers receive their dependencies through this module.
 *   - The container is a plain object, not a class or DI framework.
 *
 * ARCHITECTURE.md §3: "container.ts is the only allowed bridge."
 * ADR-0001: hexagonal architecture with enforced boundaries.
 */

import type { KeyObject } from "node:crypto";
import { config } from "./infrastructure/config/env.js";
import { logger, childLogger } from "./infrastructure/logging/logger.js";
import { SystemClock } from "./infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "./infrastructure/clock/crypto-id-generator.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { PostgresUnitOfWork } from "./infrastructure/db/unit-of-work.js";
import { PostgresLedgerRepo } from "./infrastructure/db/repositories/postgres-ledger-repo.js";
import { PostgresPasskeyRepo } from "./infrastructure/db/repositories/postgres-passkey-repo.js";
import { PostgresMandateRepo } from "./infrastructure/db/repositories/postgres-mandate-repo.js";
import { PostgresPaymentMandateRepo } from "./infrastructure/db/repositories/postgres-payment-mandate-repo.js";
import { PostgresWebhookRepo } from "./infrastructure/db/repositories/postgres-webhook-repo.js";
import { AppendLedgerEvent } from "./application/usecases/append-ledger-event.js";
import { VerifyLedger } from "./application/usecases/verify-ledger.js";
import { GenerateRegistrationOptionsUseCase } from "./application/usecases/generate-registration-options.js";
import { RegisterPasskeyUseCase } from "./application/usecases/register-passkey.js";
import { GenerateConsentOptionsUseCase } from "./application/usecases/generate-consent-options.js";
import { RecordConsentUseCase } from "./application/usecases/record-consent.js";
import { ProposeCartUseCase, type AuthorityKeyPair } from "./application/usecases/propose-cart.js";
import { CreateOrderUseCase } from "./application/usecases/create-order.js";
import { CaptureOrderUseCase } from "./application/usecases/capture-order.js";
import { ProcessWebhookUseCase } from "./application/usecases/process-webhook.js";
import { ReconcilePaymentUseCase } from "./application/usecases/reconcile-payment.js";
import { SimpleWebAuthnAdapter } from "./infrastructure/webauthn/simplewebauthn-adapter.js";
import { SessionService } from "./infrastructure/auth/session.js";
import {
  keyId,
  importPublicKeySpkiBase64,
  importPrivateKeyPkcs8Base64,
} from "./domain/crypto/signing.js";
import { FixtureCatalog } from "./infrastructure/catalog/fixture-catalog.js";
import { Channel3Catalog } from "./infrastructure/catalog/channel3-catalog.js";
import { GeminiLlmClient } from "./infrastructure/llm/gemini-adapter.js";
import { FakeLlmClient } from "./infrastructure/llm/fake-llm-client.js";
import { PayPalAdapter } from "./infrastructure/paypal/paypal-adapter.js";
import { FakePaymentProvider } from "./infrastructure/paypal/fake-payment-provider.js";
import type { UnitOfWork } from "./application/ports/unit-of-work.js";
import type { LedgerRepo } from "./application/ports/ledger-repo.js";
import type { PasskeyRepo } from "./application/ports/passkey-repo.js";
import type { MandateRepo } from "./application/ports/mandate-repo.js";
import type { PaymentMandateRepo } from "./application/ports/payment-mandate-repo.js";
import type { WebhookRepo } from "./application/ports/webhook-repo.js";
import type { PaymentProvider } from "./application/ports/payment-provider.js";
import type { WebAuthnRegistrationPort } from "./application/ports/webauthn-port.js";
import type { ProductCatalog } from "./application/ports/catalog-port.js";
import type { LlmClient } from "./application/ports/propose-port.js";
import { PostgresDashboardQuery } from "./infrastructure/db/queries/postgres-dashboard-query.js";
import { SecurityLabRunner, createDeterministicLabContext } from "./application/lab/index.js";
import type { DashboardQueryPort } from "./application/ports/dashboard-query-port.js";

// ─── Singleton adapters ───────────────────────────────────────────────────────

const clock = new SystemClock();
const idGenerator = new CryptoIdGenerator();
const webauthnAdapter = new SimpleWebAuthnAdapter();

let sessionServiceInstance: SessionService | undefined;
function getSessionService(): SessionService {
  if (!sessionServiceInstance) {
    const secret =
      config.SESSION_SECRET ??
      (config.NODE_ENV !== "production"
        ? "development-and-test-session-secret-min-32-chars-long"
        : undefined);
    if (!secret) {
      throw new Error("SESSION_SECRET is not configured");
    }
    sessionServiceInstance = new SessionService(secret);
  }
  return sessionServiceInstance;
}

let dbClientInstance: ReturnType<typeof createDatabaseClient> | undefined;

function getDbClient() {
  if (!dbClientInstance && config.DATABASE_URL) {
    dbClientInstance = createDatabaseClient({ connectionString: config.DATABASE_URL });
  }
  return dbClientInstance;
}

function getUnitOfWork(): UnitOfWork {
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; UnitOfWork cannot be initialized");
  }
  return new PostgresUnitOfWork(client.db);
}

function getLedgerRepo(): LedgerRepo {
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; LedgerRepo cannot be initialized");
  }
  return new PostgresLedgerRepo(client.db);
}

function getPasskeyRepo(): PasskeyRepo {
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; PasskeyRepo cannot be initialized");
  }
  return new PostgresPasskeyRepo(client.db);
}
let mandateRepoInstance: MandateRepo | undefined;
function getMandateRepo(): MandateRepo {
  if (mandateRepoInstance) {
    return mandateRepoInstance;
  }
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; MandateRepo cannot be initialized");
  }
  return new PostgresMandateRepo(client.db);
}

const DEV_AUTHORITY_PRIV = "MC4CAQAwBQYDK2VwBCIEIEy31hWiFwSNt3lhskBKfqaaTD1zVr46wKBcZosj5qWK";
const DEV_AUTHORITY_PUB = "MCowBQYDK2VwAyEAE2vYeJ75z6NKIded1xXZaXxBexp8typoWnPzLROXOdM=";

const DEV_MERCHANT_PRIV = "MC4CAQAwBQYDK2VwBCIEIBKji9baqeE5zi+cATTo/GSk+MWb622PRq+4Doq5gkc8";
const DEV_MERCHANT_PUB = "MCowBQYDK2VwAyEA4oDGfZy3CBL1HR4GDzPKG5kp83rxddUX7s/cCZF2nQo=";

let trustedKeysInstance:
  Map<string, { role: "AUTHORITY" | "MERCHANT"; publicKey: KeyObject }> | undefined;
function getTrustedKeys(): Map<string, { role: "AUTHORITY" | "MERCHANT"; publicKey: KeyObject }> {
  if (trustedKeysInstance) {
    return trustedKeysInstance;
  }
  const map = new Map<string, { role: "AUTHORITY" | "MERCHANT"; publicKey: KeyObject }>();
  const authorityPubB64 =
    config.AUTHORITY_PUBLIC_KEY_B64 ??
    (config.NODE_ENV !== "production" ? DEV_AUTHORITY_PUB : undefined);
  if (authorityPubB64) {
    const pub = importPublicKeySpkiBase64(authorityPubB64);
    if (pub.ok) {
      map.set(keyId(pub.value), { role: "AUTHORITY", publicKey: pub.value });
    }
  }
  const merchantPubB64 =
    config.MERCHANT_PUBLIC_KEY_B64 ??
    (config.NODE_ENV !== "production" ? DEV_MERCHANT_PUB : undefined);
  if (merchantPubB64) {
    const pub = importPublicKeySpkiBase64(merchantPubB64);
    if (pub.ok) {
      map.set(keyId(pub.value), { role: "MERCHANT", publicKey: pub.value });
    }
  }
  return map;
}

let catalogInstance: ProductCatalog | undefined;
function getCatalog(): ProductCatalog {
  if (!catalogInstance) {
    if (config.CATALOG_MODE === "channel3" && config.CHANNEL3_API_KEY) {
      catalogInstance = new Channel3Catalog(config.CHANNEL3_API_KEY, {
        fallbackCatalog: new FixtureCatalog(),
      });
    } else {
      catalogInstance = new FixtureCatalog();
    }
  }
  return catalogInstance;
}

let llmClientInstance: LlmClient | undefined;
function getLlmClient(): LlmClient {
  if (!llmClientInstance) {
    if (config.LLM_MODE === "live" && config.GEMINI_API_KEY) {
      llmClientInstance = new GeminiLlmClient(config.GEMINI_API_KEY, config.GEMINI_MODEL);
    } else {
      llmClientInstance = new FakeLlmClient();
    }
  }
  return llmClientInstance;
}

let authorityKeyPairInstance: AuthorityKeyPair | undefined;
function getAuthorityKeyPair(): AuthorityKeyPair | undefined {
  if (!authorityKeyPairInstance) {
    const privB64 =
      config.AUTHORITY_PRIVATE_KEY_B64 ??
      (config.NODE_ENV !== "production" ? DEV_AUTHORITY_PRIV : undefined);
    const pubB64 =
      config.AUTHORITY_PUBLIC_KEY_B64 ??
      (config.NODE_ENV !== "production" ? DEV_AUTHORITY_PUB : undefined);
    if (privB64 && pubB64) {
      const priv = importPrivateKeyPkcs8Base64(privB64);
      const pub = importPublicKeySpkiBase64(pubB64);
      if (priv.ok && pub.ok) {
        authorityKeyPairInstance = { privateKey: priv.value, publicKey: pub.value };
      }
    }
  }
  return authorityKeyPairInstance;
}

let merchantKeyPairInstance: AuthorityKeyPair | undefined;
function getMerchantKeyPair(): AuthorityKeyPair | undefined {
  if (!merchantKeyPairInstance) {
    const privB64 =
      config.MERCHANT_PRIVATE_KEY_B64 ??
      (config.NODE_ENV !== "production" ? DEV_MERCHANT_PRIV : undefined);
    const pubB64 =
      config.MERCHANT_PUBLIC_KEY_B64 ??
      (config.NODE_ENV !== "production" ? DEV_MERCHANT_PUB : undefined);
    if (privB64 && pubB64) {
      const priv = importPrivateKeyPkcs8Base64(privB64);
      const pub = importPublicKeySpkiBase64(pubB64);
      if (priv.ok && pub.ok) {
        merchantKeyPairInstance = { privateKey: priv.value, publicKey: pub.value };
      }
    }
  }
  return merchantKeyPairInstance;
}

let paymentMandateRepoInstance: PaymentMandateRepo | undefined;
function getPaymentMandateRepo(): PaymentMandateRepo {
  if (paymentMandateRepoInstance) {
    return paymentMandateRepoInstance;
  }
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; PaymentMandateRepo cannot be initialized");
  }
  return new PostgresPaymentMandateRepo(client.db);
}

let webhookRepoInstance: WebhookRepo | undefined;
let webhookIdOverride: string | undefined = undefined;
function getWebhookRepo(): WebhookRepo {
  if (webhookRepoInstance) {
    return webhookRepoInstance;
  }
  const client = getDbClient();
  if (!client) {
    throw new Error("DATABASE_URL is not configured; WebhookRepo cannot be initialized");
  }
  return new PostgresWebhookRepo(client.db);
}

let paymentProviderInstance: PaymentProvider | undefined;
function getPaymentProvider(): PaymentProvider {
  if (!paymentProviderInstance) {
    if (
      config.SETTLEMENT_MODE === "paypal" &&
      config.PAYPAL_CLIENT_ID &&
      config.PAYPAL_CLIENT_SECRET
    ) {
      paymentProviderInstance = new PayPalAdapter({
        clientId: config.PAYPAL_CLIENT_ID,
        clientSecret: config.PAYPAL_CLIENT_SECRET,
        env: config.PAYPAL_ENV,
      });
    } else {
      paymentProviderInstance = new FakePaymentProvider();
    }
  }
  return paymentProviderInstance;
}

// ─── Container ────────────────────────────────────────────────────────────────

let labEnabledOverride: boolean | undefined = undefined;

/**
 * The application container. Import from here in route handlers and use cases.
 * Never construct adapters anywhere else.
 */
export const container = {
  config,
  logger,
  childLogger,
  clock,
  idGenerator,
  webauthnAdapter,
  getSessionService,
  getDbClient,
  getUnitOfWork,
  getLedgerRepo,
  getPasskeyRepo,
  getMandateRepo,
  setMandateRepo: (repo: MandateRepo) => {
    mandateRepoInstance = repo;
  },
  getPaymentMandateRepo,
  setPaymentMandateRepo: (repo: PaymentMandateRepo) => {
    paymentMandateRepoInstance = repo;
  },
  getWebhookRepo,
  setWebhookRepo: (repo: WebhookRepo) => {
    webhookRepoInstance = repo;
  },
  setWebhookId: (id?: string) => {
    webhookIdOverride = id;
  },
  getPaymentProvider,
  setPaymentProvider: (provider: PaymentProvider) => {
    paymentProviderInstance = provider;
  },
  setCatalog: (catalog: ProductCatalog) => {
    catalogInstance = catalog;
  },
  getTrustedKeys,
  setTrustedKeys: (keys: Map<string, { role: "AUTHORITY" | "MERCHANT"; publicKey: KeyObject }>) => {
    trustedKeysInstance = keys;
  },
  getCatalog,
  getLlmClient,
  getAuthorityKeyPair,
  setAuthorityKeyPair: (pair: AuthorityKeyPair) => {
    authorityKeyPairInstance = pair;
  },
  getMerchantKeyPair,
  setMerchantKeyPair: (pair: AuthorityKeyPair) => {
    merchantKeyPairInstance = pair;
  },
  getAppendLedgerEvent: (uow?: UnitOfWork) =>
    new AppendLedgerEvent(clock, idGenerator, uow ?? getUnitOfWork()),
  getVerifyLedger: (repo?: LedgerRepo) => new VerifyLedger(repo ?? getLedgerRepo()),
  getGenerateRegistrationOptions: (repo?: PasskeyRepo, webauthn?: WebAuthnRegistrationPort) =>
    new GenerateRegistrationOptionsUseCase(
      clock,
      idGenerator,
      webauthn ?? webauthnAdapter,
      repo ?? getPasskeyRepo(),
    ),
  getRegisterPasskey: (
    repo?: PasskeyRepo,
    webauthn?: WebAuthnRegistrationPort,
    appendLedgerEvent?: AppendLedgerEvent,
  ) =>
    new RegisterPasskeyUseCase(
      clock,
      idGenerator,
      webauthn ?? webauthnAdapter,
      repo ?? getPasskeyRepo(),
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getGenerateConsentOptions: (passkeyRepo?: PasskeyRepo, mandateRepo?: MandateRepo) =>
    new GenerateConsentOptionsUseCase(
      clock,
      idGenerator,
      passkeyRepo ?? getPasskeyRepo(),
      mandateRepo ?? getMandateRepo(),
    ),
  getRecordConsent: (
    passkeyRepo?: PasskeyRepo,
    mandateRepo?: MandateRepo,
    appendLedgerEvent?: AppendLedgerEvent,
  ) =>
    new RecordConsentUseCase(
      clock,
      idGenerator,
      passkeyRepo ?? getPasskeyRepo(),
      mandateRepo ?? getMandateRepo(),
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getProposeCart: (
    llmClient?: LlmClient,
    catalog?: ProductCatalog,
    mandateRepo?: MandateRepo,
    authorityKeyPair?: AuthorityKeyPair,
    appendLedgerEvent?: AppendLedgerEvent,
    merchantKeyPair?: AuthorityKeyPair,
  ) =>
    new ProposeCartUseCase(
      clock,
      idGenerator,
      llmClient ?? getLlmClient(),
      catalog ?? getCatalog(),
      mandateRepo ?? getMandateRepo(),
      authorityKeyPair ?? getAuthorityKeyPair(),
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
      merchantKeyPair ?? getMerchantKeyPair(),
    ),
  getCreateOrder: (
    mandateRepo?: MandateRepo,
    paymentMandateRepo?: PaymentMandateRepo,
    paymentProvider?: PaymentProvider,
    appendLedgerEvent?: AppendLedgerEvent,
  ) =>
    new CreateOrderUseCase(
      clock,
      idGenerator,
      mandateRepo ?? getMandateRepo(),
      paymentMandateRepo ?? getPaymentMandateRepo(),
      paymentProvider ?? getPaymentProvider(),
      getTrustedKeys(),
      getAuthorityKeyPair(),
      config.DATABASE_URL ? getPasskeyRepo() : undefined,
      config.WEBAUTHN_RP_ID && config.WEBAUTHN_ORIGIN
        ? { rpId: config.WEBAUTHN_RP_ID, origin: config.WEBAUTHN_ORIGIN }
        : undefined,
      config.DATABASE_URL ? getUnitOfWork() : undefined,
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getCaptureOrder: (
    mandateRepo?: MandateRepo,
    paymentMandateRepo?: PaymentMandateRepo,
    paymentProvider?: PaymentProvider,
    appendLedgerEvent?: AppendLedgerEvent,
  ) =>
    new CaptureOrderUseCase(
      clock,
      idGenerator,
      mandateRepo ?? getMandateRepo(),
      paymentMandateRepo ?? getPaymentMandateRepo(),
      paymentProvider ?? getPaymentProvider(),
      getTrustedKeys(),
      config.DATABASE_URL ? getPasskeyRepo() : undefined,
      config.WEBAUTHN_RP_ID && config.WEBAUTHN_ORIGIN
        ? { rpId: config.WEBAUTHN_RP_ID, origin: config.WEBAUTHN_ORIGIN }
        : undefined,
      config.DATABASE_URL ? getUnitOfWork() : undefined,
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getProcessWebhook: (
    webhookRepo?: WebhookRepo,
    mandateRepo?: MandateRepo,
    paymentMandateRepo?: PaymentMandateRepo,
    paymentProvider?: PaymentProvider,
    appendLedgerEvent?: AppendLedgerEvent,
    webhookId?: string,
  ) =>
    new ProcessWebhookUseCase(
      clock,
      idGenerator,
      webhookRepo ?? getWebhookRepo(),
      mandateRepo ?? getMandateRepo(),
      paymentMandateRepo ?? getPaymentMandateRepo(),
      paymentProvider ?? getPaymentProvider(),
      webhookId ?? webhookIdOverride ?? config.PAYPAL_WEBHOOK_ID,
      config.DATABASE_URL ? getUnitOfWork() : undefined,
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getReconcilePayment: (
    mandateRepo?: MandateRepo,
    paymentMandateRepo?: PaymentMandateRepo,
    paymentProvider?: PaymentProvider,
    appendLedgerEvent?: AppendLedgerEvent,
  ) =>
    new ReconcilePaymentUseCase(
      clock,
      idGenerator,
      mandateRepo ?? getMandateRepo(),
      paymentMandateRepo ?? getPaymentMandateRepo(),
      paymentProvider ?? getPaymentProvider(),
      config.DATABASE_URL ? getUnitOfWork() : undefined,
      appendLedgerEvent ??
        (config.DATABASE_URL
          ? new AppendLedgerEvent(clock, idGenerator, getUnitOfWork())
          : undefined),
    ),
  getDashboardQuery: (dbClient?: ReturnType<typeof createDatabaseClient>): DashboardQueryPort => {
    const client = dbClient ?? getDbClient();
    return new PostgresDashboardQuery(client?.db);
  },
  getSecurityLabRunner: () => new SecurityLabRunner(),
  createLabContext: () => createDeterministicLabContext(clock, idGenerator),
  // Lab attack routes are off unless explicitly enabled (fail closed; env.ts LAB_ENABLED).
  isLabEnabled: (): boolean => labEnabledOverride ?? config.LAB_ENABLED,
  setLabEnabled: (enabled?: boolean) => {
    labEnabledOverride = enabled;
  },
} as const;

export type Container = typeof container;
