import { getDb } from "@/lib/db";
import { getRail } from "@/lib/payments";
import { handleWebhook } from "@/lib/services/disputes";

/**
 * Braintree posts webhooks as form fields bt_signature and bt_payload. The SDK
 * verifies the signature with our keys before anything is read. Events are
 * deduplicated, and state is re-read from Braintree rather than trusted from
 * the payload.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const signature = String(form.get("bt_signature") ?? "");
  const payload = String(form.get("bt_payload") ?? "");
  const r = await handleWebhook(await getDb(), getRail(), signature, payload);
  return new Response(r.outcome, { status: r.status });
}
