import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SHOTS_DIR ?? "test-results/screens";

/** The README's judge path, step by step, as written. Runs on the sandbox only: step 2 types into the real Drop-in. */
test("the README judge path", async ({ page, context }) => {
  test.setTimeout(480_000);
  const health = (await (await page.request.get("/api/health")).json()) as { rail: string };
  test.skip(health.rail !== "sandbox", "the judge path is written for the Braintree sandbox");
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await page.getByRole("link", { name: /Quarrymoor Bakehouse website/ }).first().click();
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();
  await expect(page.getByRole("link", { name: /Open as client/ })).toBeVisible();
  const client = await context.newPage();
  await client.setViewportSize({ width: 1280, height: 900 });
  await client.goto(shareUrl);
  await expect(client.getByText(/held, not charged/).first()).toBeVisible();

  // 2: typed into Braintree's frames
  const m1 = client.locator("section").first();
  await m1.locator(".braintree-dropin").waitFor({ timeout: 60_000 });
  const cardOption = m1.getByText("Card", { exact: true });
  if (await cardOption.isVisible().catch(() => false)) await cardOption.click();
  const field = (n: string) => m1.frameLocator(`iframe[name^='braintree-hosted-field-${n}']`).locator("input:not(.autofill-field)");
  await field("number").fill("4111 1111 1111 1111");
  await field("expirationDate").fill("12/30");
  for (const n of ["cvv", "postalCode"]) if (await m1.locator(`iframe[name^='braintree-hosted-field-${n}']`).count()) await field(n).fill(n === "cvv" ? "123" : "12345");
  await m1.getByRole("button", { name: /^Hold \$/ }).click();
  await expect(m1.getByText("Your money is held.")).toBeVisible({ timeout: 90_000 });
  await expect(m1.getByText("Visa ending 1111")).toBeVisible();
  await expect(m1.getByText(/Hold expires /)).toBeVisible();

  // 3
  await page.reload();
  await page.getByRole("button", { name: "v1 with a cheat" }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Tampering found on the delivered page")).toBeVisible({ timeout: 120_000 });

  // 4
  await client.reload();
  await client.getByRole("button", { name: "Request changes" }).click();
  await client.getByRole("button", { name: "Draft from the report" }).click();
  await expect(client.locator("#note")).not.toHaveValue("", { timeout: 60_000 });
  await client.getByRole("button", { name: "Send change request" }).click();
  await expect(client.getByText("You asked for changes").first()).toBeVisible();

  // 5
  await page.reload();
  await page.getByRole("button", { name: "v2, complete" }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v2")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^4 of 4 criteria met\./)).toBeVisible();

  // 6
  await client.reload();
  await client.getByRole("button", { name: "Accept and release" }).click();
  await client.locator("#signer").fill("Jordan Judge");
  await client.getByRole("button", { name: "Sign off and release payment" }).click();
  await client.getByRole("link", { name: /View receipt SO-/ }).click();
  await expect(client.getByText("(verified)")).toBeVisible();
  await expect(client.getByText(/Larkspur|Pottery/i)).toHaveCount(0);

  // 7
  await page.reload();
  await page.getByRole("button", { name: "Sandbox: simulate the client's bank disputing this payment" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve and submit evidence to Braintree" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByRole("textbox", { name: "Evidence pack" })).toHaveValue(/Jordan Judge/);
  await expect(page.getByRole("radio", { name: /^Win/ })).toBeChecked();
  await page.getByRole("button", { name: "Approve and submit evidence to Braintree" }).click();
  await expect(page.getByText("Evidence submitted. View what was sent")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(30_000);
  await expect(async () => {
    await page.getByRole("button", { name: "Reconcile with Braintree" }).click();
    await expect(page.getByText("Outcome: won")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByText("Sandbox: decided by Braintree's test value in the evidence, not by a bank")).toBeVisible();

  // 8
  const heading = page.getByRole("heading", { name: "Money by milestone" });
  await heading.scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: /^Money by milestone:/ })).toBeVisible();
  await page.getByRole("button", { name: "Landing page" }).first().click();
  await expect(page.getByText("Milestone: Landing page")).toBeVisible();
  await page.screenshot({ path: `${shots}/11-money-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "Money by milestone" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: /^Money by milestone:/ })).toBeVisible();
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width + 1);
  await page.screenshot({ path: `${shots}/12-money-390.png`, fullPage: true });
});
