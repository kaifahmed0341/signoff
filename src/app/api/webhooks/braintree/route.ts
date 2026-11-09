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
  let signature = "";
  let payload = "";
  try {
    const form = await req.formData();
    signature = String(form.get("bt_signature") ?? "");
    payload = String(form.get("bt_payload") ?? "");
  } catch {
    return new Response("Expected a form-encoded Braintree webhook", { status: 400 });
  }
  if (!signature || !payload || payload.length > 200_000) return new Response("Missing or oversized webhook fields", { status: 400 });
  const r = await handleWebhook(await getDb(), getRail(), signature, payload);
  return new Response(r.outcome, { status: r.status });
}
