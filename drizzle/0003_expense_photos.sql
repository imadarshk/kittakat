CREATE TABLE `expense_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`data_base64` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_photos_entry_idx` ON `expense_photos` (`space_id`,`entry_id`);
--> statement-breakpoint
CREATE TRIGGER expense_photos_immutable_update BEFORE UPDATE ON expense_photos
BEGIN SELECT RAISE(ABORT, 'Expense photos are immutable; append a correction'); END;
--> statement-breakpoint
CREATE TRIGGER expense_photos_immutable_delete BEFORE DELETE ON expense_photos
BEGIN SELECT RAISE(ABORT, 'Expense photos are immutable; append a correction'); END;
--> statement-breakpoint
CREATE TRIGGER expense_photos_valid_insert BEFORE INSERT ON expense_photos
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM expense_photos WHERE rowid=NEW.rowid OR id=NEW.id)
    THEN RAISE(ABORT, 'Expense photos are append-only') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM entries e JOIN users u ON u.id=e.creator_id
      WHERE e.id=NEW.entry_id AND e.space_id=NEW.space_id AND e.creator_id=NEW.uploaded_by_id AND u.auth_type IN ('password','chatgpt'))
    THEN RAISE(ABORT, 'Photo must belong to its expense and original creator') END;
END;
