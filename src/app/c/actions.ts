"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getRail } from "@/lib/payments";
import { draftChangeNote } from "@/lib/ai/checker";
import { ServiceError, acceptAndRelease, declineMilestone, fundMilestone, getMilestone, requestChanges } from "@/lib/services/milestones";
import { verifyShareToken } from "@/lib/services/ids";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Every client action proves it came from a valid share link for this milestone's project. */
async function authorizedMilestone(milestoneId: string, projectId: string, token: string) {
  if (!verifyShareToken(projectId, token)) throw new ServiceError("This link is not valid", 403);
  const db = await getDb();
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
    if (!verifyShareToken(projectId, token)) throw new ServiceError("This link is not valid", 403);
    return { ok: true, data: await getRail().clientToken() };
  } catch (err) {
    return fail(err);
  }
}

export async function fundAction(input: { projectId: string; token: string; milestoneId: string; nonce: string; deviceData?: string }): Promise<R> {
  try {
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await fundMilestone(db, getRail(), input.milestoneId, { nonce: input.nonce, deviceData: input.deviceData });
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function acceptAction(input: { projectId: string; token: string; milestoneId: string; signerName: string; amountCents?: number }): Promise<R> {
  try {
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await acceptAndRelease(db, getRail(), input.milestoneId, { signerName: input.signerName, amountCents: input.amountCents });
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function draftChangesAction(input: { projectId: string; token: string; milestoneId: string }): Promise<R<string>> {
  try {
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    return { ok: true, data: await draftChangeNote(db, input.milestoneId) };
  } catch (err) {
    return fail(err);
  }
}

export async function requestChangesAction(input: { projectId: string; token: string; milestoneId: string; note: string }): Promise<R> {
  try {
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await requestChanges(db, input.milestoneId, input.note);
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function declineAction(input: { projectId: string; token: string; milestoneId: string; reason: string }): Promise<R> {
  try {
    const { db } = await authorizedMilestone(input.milestoneId, input.projectId, input.token);
    await declineMilestone(db, getRail(), input.milestoneId, input.reason);
    done(input.projectId, input.token);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
