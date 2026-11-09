import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db";
import { mcpTokens, type McpToken, type Project } from "../db/schema";
import { audit } from "./audit";
import { newId } from "./ids";
import { getProject } from "./milestones";
import { getWorkspace } from "./workspaces";

/**
 * Agent tokens. One token reaches one project, and only the freelancer's side
 * of it: list milestones, submit a delivery, read the evidence report. The
 * plain token is returned once, at creation; only its SHA-256 hash is stored.
 */

const PREFIX = "so_agent_";
export const MAX_ACTIVE_TOKENS = 5;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createAgentToken(db: DB, projectId: string, label: string): Promise<{ token: string; row: McpToken }> {
  const active = await listAgentTokens(db, projectId);
  if (active.filter((t) => !t.revokedAt).length >= MAX_ACTIVE_TOKENS) throw new Error(`A project can have at most ${MAX_ACTIVE_TOKENS} active agent tokens. Revoke one first.`);
  const token = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  const id = newId("tok");
  await db.insert(mcpTokens).values({ id, projectId, tokenHash: hash(token), label: label.trim().slice(0, 60) || "Coding agent", createdAt: new Date() });
  await audit(db, { projectId, actor: "operator", type: "agent_token.created", message: `Agent token "${label.trim().slice(0, 60) || "Coding agent"}" created`, data: { tokenId: id } });
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, id));
  return { token, row };
}

export async function listAgentTokens(db: DB, projectId: string): Promise<McpToken[]> {
  return db.select().from(mcpTokens).where(eq(mcpTokens.projectId, projectId)).orderBy(desc(mcpTokens.createdAt));
}

export async function revokeAgentToken(db: DB, projectId: string, tokenId: string) {
  const res = await db.update(mcpTokens).set({ revokedAt: new Date() }).where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.projectId, projectId), isNull(mcpTokens.revokedAt)));
  if (res.rowsAffected === 1) await audit(db, { projectId, actor: "operator", type: "agent_token.revoked", message: "Agent token revoked", data: { tokenId } });
}

/** The project an Authorization header's token reaches, or null. Revoked tokens and pruned workspaces reach nothing. */
export async function projectForToken(db: DB, authorization: string | null): Promise<{ project: Project; token: McpToken } | null> {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!m || !m[1].startsWith(PREFIX) || m[1].length > 100) return null;
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, hash(m[1])));
  if (!row || row.revokedAt) return null;
  const project = await getProject(db, row.projectId).catch(() => null);
  if (!project || !(await getWorkspace(db, project.workspaceId))) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, row.id));
  }
  return { project, token: row };
}
