import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  scope: text("scope").notNull(),
  currency: text("currency").notNull().default("USD"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  isSample: integer("is_sample", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    deliverable: text("deliverable").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date"),
    state: text("state").notNull().default("draft"),
    // Braintree hold (a transaction authorized but not yet submitted for settlement)
    transactionId: text("transaction_id"),
    transactionStatus: text("transaction_status"),
    paymentInstrument: text("payment_instrument"),
    payerLabel: text("payer_label"),
    heldCents: integer("held_cents").notNull().default(0),
    authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }),
    authExpiresAt: integer("auth_expires_at", { mode: "timestamp_ms" }),
    settledCents: integer("settled_cents").notNull().default(0),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    // Signed acceptance record, written when the client signs off
    acceptedBy: text("accepted_by"),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptanceRecord: text("acceptance_record"),
    acceptanceSignature: text("acceptance_signature"),
    receiptNumber: text("receipt_number"),
    changeNote: text("change_note"),
    fundingAttempt: integer("funding_attempt").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("milestones_project_idx").on(t.projectId), index("milestones_txn_idx").on(t.transactionId)],
);

export const criteria = sqliteTable("criteria", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  text: text("text").notNull(),
  sourceQuote: text("source_quote").notNull(),
  quoteVerified: integer("quote_verified", { mode: "boolean" }).notNull().default(false),
});

export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  links: text("links", { mode: "json" }).$type<string[]>().notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const deliveryFiles = sqliteTable("delivery_files", {
  id: text("id").primaryKey(),
  deliveryId: text("delivery_id")
    .notNull()
    .references(() => deliveries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  text: text("text").notNull(),
});

export const checks = sqliteTable("checks", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  deliveryId: text("delivery_id")
    .notNull()
    .references(() => deliveries.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  model: text("model").notNull(),
  summary: text("summary"),
  error: text("error"),
  droppedEvidence: integer("dropped_evidence").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(now),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export type EvidenceItem = { source: string; quote: string };

export const verdicts = sqliteTable("verdicts", {
  id: text("id").primaryKey(),
  checkId: text("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  criterionId: text("criterion_id")
    .notNull()
    .references(() => criteria.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(),
  reasoning: text("reasoning").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<EvidenceItem[]>().notNull(),
  note: text("note"),
});

export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  checkId: text("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  tool: text("tool").notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    milestoneId: text("milestone_id"),
    actor: text("actor").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("audit_project_idx").on(t.projectId)],
);

export const disputes = sqliteTable("disputes", {
  id: text("id").primaryKey(), // Braintree dispute id
  milestoneId: text("milestone_id")
    .notNull()
    .references(() => milestones.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  kind: text("kind"),
  amountCents: integer("amount_cents").notNull().default(0),
  replyByDate: text("reply_by_date"),
  evidencePack: text("evidence_pack"),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  evidenceIds: text("evidence_ids", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    resourceId: text("resource_id"),
    verified: integer("verified", { mode: "boolean" }).notNull(),
    payload: text("payload").notNull(),
    outcome: text("outcome"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("webhook_event_id_idx").on(t.id)],
);

export type Project = typeof projects.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Criterion = typeof criteria.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryFile = typeof deliveryFiles.$inferSelect;
export type Check = typeof checks.$inferSelect;
export type Verdict = typeof verdicts.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Dispute = typeof disputes.$inferSelect;
