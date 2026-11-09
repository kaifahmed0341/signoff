CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`milestone_id` text,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_project_idx` ON `audit_events` (`project_id`);--> statement-breakpoint
CREATE TABLE `checks` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text NOT NULL,
	`summary` text,
	`error` text,
	`dropped_evidence` integer DEFAULT 0 NOT NULL,
	`progress` text,
	`fallback_reason` text,
	`findings` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`source_quote` text NOT NULL,
	`quote_verified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`version` integer NOT NULL,
	`links` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `delivery_files` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`role` text DEFAULT 'notes' NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`kind` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`reply_by_date` text,
	`evidence_pack` text,
	`approved_at` integer,
	`submitted_at` integer,
	`evidence_ids` text,
	`last_event_at` integer,
	`outcome_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fake_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`kind` text,
	`amount_cents` integer NOT NULL,
	`reply_by_date` text,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fake_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`instrument` text NOT NULL,
	`payer_label` text,
	`authorization_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`opens_dispute` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`deliverable` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`transaction_id` text,
	`transaction_status` text,
	`payment_instrument` text,
	`payer_label` text,
	`held_cents` integer DEFAULT 0 NOT NULL,
	`authorized_at` integer,
	`auth_expires_at` integer,
	`settled_cents` integer DEFAULT 0 NOT NULL,
	`released_at` integer,
	`accepted_by` text,
	`accepted_at` integer,
	`acceptance_record` text,
	`acceptance_signature` text,
	`receipt_number` text,
	`change_note` text,
	`funding_attempt` integer DEFAULT 0 NOT NULL,
	`claimed_from` text,
	`attention` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestones_project_idx` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE INDEX `milestones_txn_idx` ON `milestones` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`client_name` text NOT NULL,
	`client_email` text,
	`scope` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`sent_at` integer,
	`link_secret` text DEFAULT '' NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`position` integer NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`ok` integer NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `checks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`day` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`verdict` text NOT NULL,
	`reasoning` text NOT NULL,
	`evidence` text NOT NULL,
	`dropped` text DEFAULT '[]' NOT NULL,
	`note` text,
	FOREIGN KEY (`check_id`) REFERENCES `checks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`resource_id` text,
	`verified` integer NOT NULL,
	`payload` text NOT NULL,
	`outcome` text,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_id_idx` ON `webhook_events` (`id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
