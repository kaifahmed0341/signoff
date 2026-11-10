import { test as base, expect, type BrowserContext } from "@playwright/test";

/**
 * Production runs send the test-only bypass for the per-address workspace count, if one is set,
 * and only to the app's own origin: never to Braintree or any other host the page calls.
 */
export async function withBypass(context: BrowserContext, baseURL: string | undefined) {
  const token = process.env.E2E_BYPASS_TOKEN;
  if (!token || !baseURL) return;
  const origin = new URL(baseURL).origin;
  await context.route((url) => url.origin === origin, (route) => route.continue({ headers: { ...route.request().headers(), "x-signoff-e2e": token } }));
}

export const test = base.extend<{ bypass: void }>({
  bypass: [
    async ({ context, baseURL }, use) => {
      await withBypass(context, baseURL);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
