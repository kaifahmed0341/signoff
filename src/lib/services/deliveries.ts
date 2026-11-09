import { desc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { deliveries, deliveryFiles } from "../db/schema";
import { audit } from "./audit";
import { newId } from "./ids";
import { ServiceError, applyEvent, getMilestone } from "./milestones";

export type DeliveryInput = {
  links: string[];
  notes: string;
  files: { name: string; mime: string; text: string }[];
};

export function cleanLinks(raw: string[]): string[] {
  const out: string[] = [];
  for (const l of raw.map((x) => x.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(l);
    } catch {
      throw new ServiceError(`Not a valid link: ${l}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new ServiceError(`Links must start with http or https: ${l}`);
    out.push(u.toString());
  }
  return [...new Set(out)].slice(0, 10);
}

/** Operator submits a delivery. The milestone moves to "checking"; the caller starts the checker. */
export async function submitDelivery(db: DB, milestoneId: string, input: DeliveryInput): Promise<string> {
  const m = await getMilestone(db, milestoneId);
  const links = cleanLinks(input.links);
  if (links.length === 0 && input.files.length === 0) throw new ServiceError("Add at least one link or file");
  const [prev] = await db.select().from(deliveries).where(eq(deliveries.milestoneId, m.id)).orderBy(desc(deliveries.version)).limit(1);
  const version = (prev?.version ?? 0) + 1;
  await applyEvent(db, m, "SUBMIT_DELIVERY");
  const id = newId("dl");
  await db.insert(deliveries).values({ id, milestoneId: m.id, version, links, notes: input.notes.trim(), createdAt: new Date() });
  for (const f of input.files.slice(0, 5)) {
    await db.insert(deliveryFiles).values({ id: newId("df"), deliveryId: id, name: f.name.slice(0, 200), mime: f.mime, text: f.text.slice(0, 200_000) });
  }
  await audit(db, {
    projectId: m.projectId,
    milestoneId: m.id,
    actor: "operator",
    type: "delivery.submitted",
    message: `Delivery v${version} submitted with ${links.length} link(s) and ${input.files.length} file(s)`,
    data: { deliveryId: id, links },
  });
  return id;
}
