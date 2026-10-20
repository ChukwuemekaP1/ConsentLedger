import { test, expect } from "@playwright/test";

test.describe("Agent and Approval UI (Phase 7A) with Virtual Authenticator", () => {
  test.beforeEach(async ({ page }) => {
    // Enable Chromium WebAuthn virtual authenticator
    const client = await page.context().newCDPSession(page);
    await client.send("WebAuthn.enable");
    await client.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasUserVerification: true,
        isUserVerified: true,
        hasResidentKey: true,
        automaticPresenceSimulation: true,
      },
    });
  });

  test("shows validation errors when fields are empty", async ({ page }) => {
    await page.goto("/");

    // Register with empty name
    await page.click('button:has-text("Register passkey")');
    await expect(page.locator("#display-name-error")).toBeVisible();
    await expect(page.locator("#display-name-error")).toHaveText(
      "Enter a name for this passkey, for example your first name.",
    );

    // Ask agent with empty prompt
    await page.click('button:has-text("Ask the agent")');
    await expect(page.locator("#prompt-error")).toBeVisible();
    await expect(page.locator("#prompt-error")).toHaveText(
      "Describe what you want the agent to buy.",
    );
  });

  test("full journey: register passkey -> propose -> review mandate -> passkey consent -> PayPal order", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto("/");

    // 1. Register passkey with virtual authenticator
    await page.fill("#display-name", "E2E Tester");
    await page.click('button:has-text("Register passkey")');

    // Confirm passkey registered
    await expect(page.getByText("Passkey registered", { exact: true })).toBeVisible({
      timeout: 15000,
    });

    // 2. Propose a purchase
    await page.click('button:has-text("Buy a 75% mechanical keyboard")');
    await page.click('button:has-text("Ask the agent")');

    // Confirm loading state
    await expect(page.locator("text=Searching the catalog and drafting a proposal")).toBeVisible();

    // 3. Review the Mandate Card
    await expect(
      page.locator('role=heading[name="Review, then approve with your passkey"]'),
    ).toBeVisible({ timeout: 30000 });

    const card = page.locator("article.mandate");
    await expect(card).toBeVisible();
    await expect(card.locator("h2.mandate__payee")).toContainText("ShopX");
    await expect(card.locator('[data-testid="mandate-total"]')).toContainText("$85.00 USD");
    await expect(card.getByText("Policy: Allowed")).toBeVisible();
    await expect(card.getByText("Unsigned", { exact: true })).toBeVisible();

    // 4. Sign mandate with virtual authenticator
    await page.click('button:has-text("Approve with passkey")');

    // 5. Consent verified and PayPal order created
    await expect(page.getByText("Signed with passkey", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('role=heading[name="PayPal order created"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("text=Your passkey approval is recorded.")).toBeVisible();
    await expect(page.getByText("PayPal order", { exact: true })).toBeVisible();
  });
});
