import { expect, test } from "@playwright/test";

test("operator and client run the full loop on the test rail", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Load sample project" }).click();
  await expect(page.getByRole("heading", { name: "Larkspur Pottery Studio website" })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/01-project.png", fullPage: true });
  const shareUrl = await page.locator('input[readonly]').first().inputValue();

  // Client funds milestone 1 with a hold.
  const client = await context.newPage();
  await client.goto(shareUrl);
  await expect(client.getByText("Fund this milestone with a hold").first()).toBeVisible();
  await client.screenshot({ path: "test-results/screens/02-client-fund.png", fullPage: true });
  await client.getByRole("button", { name: "PayPal account (test nonce)" }).first().click();
  await expect(client.getByText("held, not charged").first()).toBeVisible();

  // Operator submits v1, which misses two criteria.
  await page.reload();
  await page.getByRole("button", { name: /v1 \(misses two criteria\)/ }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v1")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/screens/03-report-v1.png", fullPage: true });

  // Client reads the report and asks for changes with a drafted note.
  await client.reload();
  await expect(client.getByText("Your decision")).toBeVisible();
  await client.getByRole("button", { name: "Draft from the report" }).click();
  await expect(client.locator("#note")).toHaveValue(/Saturday/);
  await client.screenshot({ path: "test-results/screens/04-client-changes.png", fullPage: true });
  await client.getByRole("button", { name: "Send change request" }).click();
  await expect(client.getByText("You asked for changes").first()).toBeVisible();

  // Operator submits v2, which passes.
  await page.reload();
  await page.getByRole("button", { name: /v2 \(complete\)/ }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v2")).toBeVisible({ timeout: 30_000 });

  // Client signs off and releases.
  await client.reload();
  await client.locator("#signer").fill("Robin Client");
  await client.screenshot({ path: "test-results/screens/05-client-accept.png", fullPage: true });
  await client.getByRole("button", { name: "Sign off and release payment" }).click();
  await expect(client.getByRole("link", { name: /View receipt SO-/ })).toBeVisible();

  await client.getByRole("link", { name: /View receipt SO-/ }).click();
  await expect(client.getByText("(verified)")).toBeVisible();
  await client.screenshot({ path: "test-results/screens/06-receipt.png", fullPage: true });

  // A dispute opens; operator approves the drafted evidence.
  await page.reload();
  await page.getByRole("button", { name: "Send a signed dispute webhook" }).click();
  await expect(page.getByText("Approve and submit evidence to Braintree")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/07-dispute.png", fullPage: true });
  await page.getByRole("button", { name: "Approve and submit evidence to Braintree" }).click();
  await expect(page.getByText("Evidence submitted. View what was sent")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/08-timeline.png", fullPage: true });
});
