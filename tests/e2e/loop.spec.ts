import type { Page } from "@playwright/test";
import { expect, test, withBypass } from "./fixtures";

const shots = process.env.E2E_SHOTS_DIR ?? "test-results/screens";

/** "sandbox" when the server runs on the Braintree sandbox, "fake" on the test rail. */
async function railOf(page: Page): Promise<string> {
  const r = await page.request.get("/api/health");
  return ((await r.json()) as { rail: string }).rail;
}

/** Types a card into the real Drop-in's frames on the first milestone and asks for the hold. */
async function holdWithCard(client: Page, card: string) {
  const m1 = client.locator("section").first();
  await m1.locator(".braintree-dropin").waitFor({ timeout: 60_000 });
  const cardOption = m1.getByText("Card", { exact: true });
  if (await cardOption.isVisible().catch(() => false)) await cardOption.click();
  const field = (n: string) => m1.frameLocator(`iframe[name^='braintree-hosted-field-${n}']`).locator("input:not(.autofill-field)");
  await field("number").fill(card);
  await field("expirationDate").fill("12/30");
  for (const n of ["cvv", "postalCode"]) if (await m1.locator(`iframe[name^='braintree-hosted-field-${n}']`).count()) await field(n).fill(n === "cvv" ? "123" : "12345");
  await m1.getByRole("button", { name: /^Hold \$/ }).click();
}

/** Pays the first unfunded milestone: through the real Drop-in on the sandbox, typing the card into its frames. */
async function fundFirstMilestone(client: Page, rail: string, card = "4111111111111111") {
  if (rail !== "sandbox") await client.getByRole("button", { name: "PayPal account (test nonce)" }).first().click();
  else await holdWithCard(client, card);
  await expect(client.getByText("Your money is held.").first()).toBeVisible({ timeout: 90_000 });
}

/** A declined card: the reason stays on the page, not in a toast that fades. */
async function declineFirst(client: Page, rail: string) {
  if (rail !== "sandbox") await client.getByRole("button", { name: "Try a declined card" }).first().click();
  else await holdWithCard(client, "4000111111111115");
  const alert = client.locator("section").first().getByRole("alert").filter({ hasText: "No hold was placed." });
  await expect(alert).toBeVisible({ timeout: 60_000 });
  await client.waitForTimeout(6_000);
  await expect(alert).toBeVisible();
}

async function noSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width + 1);
}

test("a visitor runs the whole loop in a private demo workspace", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Proof of delivery for services/ })).toBeVisible();
  await page.screenshot({ path: `${shots}/00-front.png`, fullPage: true });
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.getByRole("link", { name: /Quarrymoor Bakehouse website/ }).first().click();
  await expect(page.getByRole("heading", { name: "Quarrymoor Bakehouse website" })).toBeVisible();
  await page.screenshot({ path: `${shots}/01-project.png`, fullPage: true });
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();

  // The client funds milestone 1 with a hold.
  const client = await context.newPage();
  await client.goto(shareUrl);
  await expect(client.getByText("Fund this milestone with a hold").first()).toBeVisible();
  const rail = await railOf(page);
  if (rail === "sandbox") await client.locator("section").first().locator(".braintree-dropin").waitFor({ timeout: 60_000 });
  await client.screenshot({ path: `${shots}/02-client-fund.png`, fullPage: true });
  // A declined card first: the reason stays inline and the form takes another card.
  await declineFirst(client, rail);
  // Braintree's ordinary test card: an authorization, so the money is held, not charged.
  await fundFirstMilestone(client, rail, "4111111111111111");
  await expect(client.getByText(/Visa ending 1111|PayPal buyer/).first()).toBeVisible();

  // The operator submits the cheat version. The report shows the tampering and the removed quotes.
  await page.reload();
  await page.getByRole("button", { name: "v1 with a cheat" }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v1")).toBeVisible();
  await expect(page.getByText("Tampering found on the delivered page")).toBeVisible();
  // Whatever the checker (scripted or a live model) concluded, the hidden start time must not pass.
  const saturday = page.locator("li", { hasText: "The page lists the Saturday sourdough class" }).last();
  await expect(saturday.getByText("Met", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/03-report-cheat.png`, fullPage: true });

  // The client asks for changes with a drafted note.
  await client.reload();
  await expect(client.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await client.getByRole("button", { name: "Request changes" }).click();
  await client.getByRole("button", { name: "Draft from the report" }).click();
  await expect(client.locator("#note")).toHaveValue(/Saturday/);
  await client.getByRole("button", { name: "Send change request" }).click();
  await expect(client.getByText("You asked for changes").first()).toBeVisible();

  // The operator submits v2, which passes.
  await page.reload();
  await page.getByRole("button", { name: "v2, complete" }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v2")).toBeVisible();

  // The client signs off and releases.
  await client.reload();
  await client.locator("#signer").fill("Robin Client");
  await client.screenshot({ path: `${shots}/04-client-accept.png`, fullPage: true });
  await client.getByRole("button", { name: "Sign off and release payment" }).click();
  await expect(client.getByRole("link", { name: /View receipt SO-/ })).toBeVisible();
  await client.getByRole("link", { name: /View receipt SO-/ }).click();
  await expect(client.getByText("(verified)")).toBeVisible();
  await client.screenshot({ path: `${shots}/05-receipt.png`, fullPage: true });

  // A chargeback opens; the operator approves evidence drafted from the signed record.
  // After sign-off: the operator simulates the client's bank disputing this payment (a stand-in sandbox charge with the dispute card).
  await page.reload();
  await page.getByRole("button", { name: "Sandbox: simulate the client's bank disputing this payment" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve and submit evidence to Braintree" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByRole("textbox", { name: "Evidence pack" })).toHaveValue(/Robin Client/);
  await expect(page.getByRole("button", { name: "Approve and submit evidence to Braintree" })).toBeVisible();
  await expect(page.getByText(/Chargeback opened for \$450\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and submit evidence to Braintree" }).click();
  await client.goto(shareUrl);
  await expect(client.getByText("A chargeback was opened on this payment")).toBeVisible();
  await expect(page.getByText("Evidence submitted. View what was sent")).toBeVisible({ timeout: 60_000 });
  // The test rail decides at once; the sandbox rules about 25 seconds after evidence is finalized.
  await expect(async () => {
    await page.getByRole("button", { name: "Reconcile with Braintree" }).click();
    await expect(page.getByText("Outcome: won")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByText("Sandbox: decided by Braintree's test value in the evidence, not by a bank")).toBeVisible();
  await client.goto(shareUrl);
  await expect(client.getByText("It was decided for the freelancer, so the payment stands.")).toBeVisible();
  await page.screenshot({ path: `${shots}/06-dispute.png`, fullPage: true });

  // Phone width: no page is wider than the screen.
  for (const [p, url, name] of [[client, shareUrl, "07-client-390"], [page, page.url(), "08-operator-390"], [page, "/dashboard", "09-dashboard-390"]] as const) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(url);
    await p.waitForLoadState("networkidle");
    await noSidewaysScroll(p);
    await p.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  }
});

test("each visitor sees only their own workspace", async ({ browser, baseURL }) => {
  const ctxA = await browser.newContext({ baseURL });
  const ctxB = await browser.newContext({ baseURL });
  for (const c of [ctxA, ctxB]) await withBypass(c, baseURL);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  for (const p of [a, b]) {
    await p.goto("/");
    await p.getByRole("button", { name: "Try the live demo" }).click();
    await expect(p.getByText("Demo workspace.")).toBeVisible();
  }
  // The demo starts with the sample loaded, so the loader button is hidden.
  await expect(a.getByRole("button", { name: "Load sample project" })).toHaveCount(0);
  await a.getByRole("link", { name: /Quarrymoor Bakehouse website/ }).first().click();
  await expect(a.getByRole("heading", { name: "Quarrymoor Bakehouse website" })).toBeVisible();
  const projectUrl = a.url();
  await b.goto("/dashboard");
  await expect(b.getByRole("link", { name: /Quarrymoor Bakehouse website/ })).toHaveCount(1);
  await b.goto(projectUrl);
  await expect(b.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
});

test("an operator drafts milestones from a pasted scope, edits them and creates a client link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.goto("/projects/new");
  await page.getByRole("textbox", { name: "Project name" }).fill("Bakery site from the e2e test");
  await page.getByRole("button", { name: "Use the sample scope" }).click();
  await page.getByRole("button", { name: "Draft milestones" }).click();
  await expect(page.getByText("Milestone 2")).toBeVisible({ timeout: 120_000 });
  // The planner keeps a name the freelancer typed.
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Bakery site from the e2e test");
  await expect(page.getByText(/From the scope:/).first()).toBeVisible();
  await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR ?? "test-results/screens"}/10-new-project.png`, fullPage: true });
  await page.getByRole("button", { name: "Save and create client link" }).click();
  await expect(page.getByRole("heading", { name: "Bakery site from the e2e test" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Client link" })).toBeVisible();
});

test("a coding agent works the freelancer's side over MCP, until its token is revoked", async ({ page, context, baseURL }) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await page.getByRole("link", { name: /Quarrymoor Bakehouse website/ }).first().click();
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();
  const client = await context.newPage();
  await client.goto(shareUrl);
  if ((await railOf(page)) === "sandbox") await client.getByRole("button", { name: "Quick hold with the test card" }).first().click();
  else await client.getByRole("button", { name: "Card (test nonce)" }).first().click();
  await expect(client.getByText("Your money is held.").first()).toBeVisible({ timeout: 90_000 });

  await page.reload();
  await page.getByText("Agent access").click();
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByRole("textbox", { name: "New agent token" }).inputValue();
  expect(token).toMatch(/^so_agent_/);

  const connect = async () => {
    const c = new Client({ name: "e2e-agent", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${baseURL}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return c;
  };
  const agent = await connect();
  const list = (await agent.callTool({ name: "list_milestones", arguments: {} })).structuredContent as { milestones: { id: string; can_submit: boolean }[] };
  const target = list.milestones.find((m) => m.can_submit)!;
  const sub = await agent.callTool({ name: "submit_delivery", arguments: { milestone_id: target.id, links: [`${baseURL}/samples/sample-v2/index.html`], notes: "Submitted by the agent" } });
  expect(sub.isError).toBeFalsy();
  let status = "running";
  let report: { check: { status: string; criteria?: { verdict: string }[] } } | null = null;
  for (let i = 0; i < 40 && status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    report = (await agent.callTool({ name: "read_evidence_report", arguments: { milestone_id: target.id } })).structuredContent as typeof report;
    status = report!.check.status;
  }
  expect(status).toBe("done");
  expect(report!.check.criteria!.filter((c) => c.verdict === "met").length).toBeGreaterThanOrEqual(3);
  await agent.close();

  await page.reload();
  await expect(page.getByText("Delivery submitted by the coding agent").first()).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(connect()).rejects.toThrow();
});

test("a hold that ends before the due date is flagged, and the client renews it", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.getByRole("link", { name: /Quarrymoor Bakehouse website/ }).first().click();
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();
  const rail = await railOf(page);
  const client = await context.newPage();
  await client.goto(shareUrl);
  // Milestone 2 is due in 12 days, past a card hold. Its card form opens on demand.
  const m2 = client.locator("section").nth(1);
  await expect(m2.getByText(/a card hold placed now ends before the due date/)).toBeVisible();
  await m2.getByRole("button", { name: /^Fund this milestone: / }).click();
  const quick = rail === "sandbox" ? "Quick hold with the test card" : "Card (test nonce)";
  await m2.getByRole("button", { name: quick }).click();
  await expect(m2.getByText("Your money is held.")).toBeVisible({ timeout: 60_000 });
  await expect(m2.getByText(/This hold ends .* before the milestone is due/)).toBeVisible();
  const before = (await m2.getByText(/^txn /).textContent())!.trim();
  await m2.getByText("Renew the hold before it ends").click();
  await m2.getByRole("button", { name: quick }).click();
  await expect(m2.getByText(/^txn /)).not.toHaveText(before, { timeout: 60_000 });
  await page.reload();
  await expect(page.getByText(/Client renewed the hold/).first()).toBeVisible();
});

test("a chargeback after sign-off works on a project the freelancer wrote from scratch", async ({ page, context, baseURL }) => {
  test.setTimeout(420_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.goto("/projects/new");
  await page.getByRole("textbox", { name: "Project name" }).fill("Signoff front page review");
  await page.locator("#p-client").fill("Harbor Lane Books");
  await page.locator("#scope").fill(
    [
      "Harbor Lane Books wants a short review of a public product page.",
      "",
      "Milestone 1: Product page review ($120, due in 4 days)",
      "- The page explains that payment is held until the client signs off",
      "- The page links to the source code on GitHub",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Draft milestones" }).click();
  await expect(page.getByText("Milestone 1").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Signoff front page review");
  await page.getByRole("button", { name: "Save and create client link" }).click();
  await expect(page.getByRole("heading", { name: "Signoff front page review" })).toBeVisible();
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();
  const rail = await railOf(page);

  const client = await context.newPage();
  await client.goto(shareUrl);
  await client.getByRole("button", { name: rail === "sandbox" ? "Quick hold with the test card" : "Card (test nonce)" }).first().click();
  await expect(client.getByText("Your money is held.").first()).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await page.locator("textarea[name=links]").first().fill(`${baseURL}/`);
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v1")).toBeVisible({ timeout: 180_000 });

  await client.reload();
  // Nothing was met, so the panel opens on changes; the client accepts anyway.
  await client.getByRole("button", { name: "Accept and release" }).click();
  await client.locator("#signer").fill("Avery Buyer");
  await client.getByRole("button", { name: "Sign off and release payment" }).click();
  await expect(client.getByRole("link", { name: /View receipt SO-/ })).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await page.getByRole("button", { name: "Sandbox: simulate the client's bank disputing this payment" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve and submit evidence to Braintree" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByRole("textbox", { name: "Evidence pack" })).toHaveValue(/Avery Buyer/);
  await page.getByRole("button", { name: "Approve and submit evidence to Braintree" }).click();
  await expect(page.getByText("Evidence submitted. View what was sent")).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    await page.getByRole("button", { name: "Reconcile with Braintree" }).click();
    await expect(page.getByText("Outcome: won")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await client.goto(shareUrl);
  await expect(client.getByText("It was decided for the freelancer, so the payment stands.")).toBeVisible();
});
