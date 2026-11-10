"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getRail } from "@/lib/payments";
import { draftChangeNote } from "@/lib/ai/checker";
import { ServiceError, acceptAndRelease, declineMilestone, fundMilestone, renewHold, getMilestone, projectFromShareLink, requestChanges } from "@/lib/services/milestones";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// Every input from the browser is validated before it reaches a service.
const ids = { projectId: z.string().min(1).max(64), token: z.string().min(1).max(64), milestoneId: z.string().min(1).max(64) };
const fundInput = z.object({ ...ids, nonce: z.string().min(1).max(4000), deviceData: z.string().max(10_000).optional() });
const acceptInput = z.object({ ...ids, signerName: z.string().trim().min(2).max(120), amountCents: z.number().int().positive().max(100_000_000).optional() });
const changesInput = z.object({ ...ids, note: z.string().trim().min(3).max(4000) });
const declineInput = z.object({ ...ids, reason: z.string().max(2000) });
const idsInput = z.object(ids);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ServiceError(`That request was not valid: ${r.error.issues[0]?.message ?? "bad input"}`);
  return r.data;
}

/** Every client action proves it came from a valid share link for this milestone's project. */
async function authorizedMilestone(milestoneId: string, projectId: string, token: string) {
  const db = await getDb();
  await projectFromShareLink(db, projectId, token);
  const m = await getMilestone(db, milestoneId);
  if (m.projectId !== projectId) throw new ServiceError("This link is not valid", 403);
  return { db, m };
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function done(projectId: string, token: string) {
  revalidatePath(`/c/${projectId}/${token}`);
}

export async function clientTokenAction(projectId: string, token: string): Promise<R<string>> {
  try {
    parse(z.object({ projectId: ids.projectId, token: ids.token }), { projectId, token });
    await projectFromShareLink(await getDb(), projectId, token);
    return { ok: true, data: await getRail().clientToken() };
  } catch (err) {
    return fail(err);
  }
}

export async function fundAction(raw: { projectId: string; token: string; milestoneId: string; nonce: string; deviceData?: string }): Promise<R> {
  try {
    const input = parse(fundInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await fundMilestone(db, getRail(), input.milestoneId, { nonce: input.nonce, deviceData: input.deviceData });
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function renewHoldAction(raw: { projectId: string; token: string; milestoneId: string; nonce: string; deviceData?: string }): Promise<R> {
  try {
    const input = parse(fundInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await renewHold(db, getRail(), input.milestoneId, { nonce: input.nonce, deviceData: input.deviceData });
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function acceptAction(raw: { projectId: string; token: string; milestoneId: string; signerName: string; amountCents?: number }): Promise<R> {
  try {
    const input = parse(acceptInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await acceptAndRelease(db, getRail(), input.milestoneId, { signerName: input.signerName, amountCents: input.amountCents });
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function draftChangesAction(raw: { projectId: string; token: string; milestoneId: string }): Promise<R<string>> {
  try {
    const input = parse(idsInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    return { ok: true, data: await draftChangeNote(db, input.milestoneId) };
  } catch (err) {
    return fail(err);
  }
}

export async function requestChangesAction(raw: { projectId: string; token: string; milestoneId: string; note: string }): Promise<R> {
  try {
    const input = parse(changesInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await requestChanges(db, input.milestoneId, input.note);
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function declineAction(raw: { projectId: string; token: string; milestoneId: string; reason: string }): Promise<R> {
  try {
    const input = parse(declineInput, raw);
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await declineMilestone(db, getRail(), input.milestoneId, input.reason);
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
