ALTER TABLE `checks` ADD `change_note_draft` text;--> statement-breakpoint
ALTER TABLE `milestones` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ip_hash` text;