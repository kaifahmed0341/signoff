import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SHOTS_DIR ?? "test-results/screens";

async function noSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width + 1);
}

test("a visitor runs the whole loop in a private demo workspace", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Get paid the moment/ })).toBeVisible();
  await page.screenshot({ path: `${shots}/00-front.png`, fullPage: true });
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.getByRole("link", { name: /Larkspur Pottery Studio website/ }).first().click();
  await expect(page.getByRole("heading", { name: "Larkspur Pottery Studio website" })).toBeVisible();
  await page.screenshot({ path: `${shots}/01-project.png`, fullPage: true });
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();

  // The client funds milestone 1 with a hold.
  const client = await context.newPage();
  await client.goto(shareUrl);
  await expect(client.getByText("Fund this milestone with a hold").first()).toBeVisible();
  await client.screenshot({ path: `${shots}/02-client-fund.png`, fullPage: true });
  await client.getByRole("button", { name: "PayPal account (test nonce)" }).first().click();
  await expect(client.getByText("Your money is held.").first()).toBeVisible();

  // The operator submits the cheat version. The report shows the tampering and the removed quotes.
  await page.reload();
  await page.getByRole("button", { name: "v1 with a cheat" }).click();
  await page.getByRole("button", { name: "Submit delivery for checking" }).click();
  await expect(page.getByText("Evidence report for delivery v1")).toBeVisible();
  await expect(page.getByText("Tampering found on the delivered page")).toBeVisible();
  // Whatever the checker (scripted or a live model) concluded, the hidden start time must not pass.
  const saturday = page.locator("li", { hasText: "The page lists the Saturday wheel-throwing class" }).last();
  await expect(saturday.getByText("Met", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/03-report-cheat.png`, fullPage: true });

  // The client asks for changes with a drafted note.
  await client.reload();
  await expect(client.getByText("Your decision")).toBeVisible();
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
  await page.reload();
  await page.getByRole("button", { name: "Open a chargeback with a signed webhook" }).click();
  await expect(page.getByRole("button", { name: "Approve and submit evidence to Braintree" })).toBeVisible();
  await expect(page.getByText(/Chargeback opened for \$450\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and submit evidence to Braintree" }).click();
  await expect(page.getByText("Outcome: won")).toBeVisible();
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

test("each visitor sees only their own workspace", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto("/");
    await p.getByRole("button", { name: "Try the live demo" }).click();
    await expect(p.getByText("Demo workspace.")).toBeVisible();
  }
  await a.getByRole("button", { name: "Load sample project" }).click();
  await expect(a.getByRole("heading", { name: "Larkspur Pottery Studio website" })).toBeVisible();
  const projectUrl = a.url();
  await b.goto("/dashboard");
  await expect(b.getByRole("link", { name: /Larkspur Pottery Studio website/ })).toHaveCount(1);
  await b.goto(projectUrl);
  await expect(b.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
});

test("an operator drafts milestones from a pasted scope, edits them and creates a client link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await expect(page.getByText("Demo workspace.")).toBeVisible();
  await page.goto("/projects/new");
  await page.getByRole("button", { name: "Use the sample scope" }).click();
  await page.getByRole("button", { name: "Draft milestones" }).click();
  await expect(page.getByText("Milestone 2")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/From the scope:/).first()).toBeVisible();
  await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR ?? "test-results/screens"}/10-new-project.png`, fullPage: true });
  await page.getByRole("textbox", { name: "Project name" }).fill("Pottery site from the e2e test");
  await page.getByRole("button", { name: "Save and create client link" }).click();
  await expect(page.getByRole("heading", { name: "Pottery site from the e2e test" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Client link" })).toBeVisible();
});

test("a coding agent works the freelancer's side over MCP, until its token is revoked", async ({ page, context, baseURL }) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.goto("/");
  await page.getByRole("button", { name: "Try the live demo" }).click();
  await page.getByRole("link", { name: /Larkspur Pottery Studio website/ }).first().click();
  const shareUrl = await page.getByRole("textbox", { name: "Client link" }).inputValue();
  const client = await context.newPage();
  await client.goto(shareUrl);
  await client.getByRole("button", { name: "Card (test nonce)" }).first().click();
  await expect(client.getByText("Your money is held.").first()).toBeVisible();

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
  const sub = await agent.callTool({ name: "submit_delivery", arguments: { milestone_id: target.id, links: [`${baseURL}/samples/larkspur-v2/index.html`], notes: "Submitted by the agent" } });
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
