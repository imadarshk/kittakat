-- Historical money records and audit events are append-only, even for direct SQL.
-- INSERT guards also block SQLite REPLACE, whose implicit deletes can bypass
-- DELETE triggers when recursive_triggers is off. Corrections append first,
-- then advance the entry pointer inside the same atomic service batch.
CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON revisions
BEGIN SELECT RAISE(ABORT, 'Financial revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON revisions
BEGIN SELECT RAISE(ABORT, 'Financial revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_append_only BEFORE INSERT ON revisions
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM revisions WHERE rowid=NEW.rowid OR (entry_id=NEW.entry_id AND revision=NEW.revision))
    THEN RAISE(ABORT, 'Financial revisions are append-only') END;
  SELECT CASE WHEN typeof(NEW.revision)!='integer'
    OR NEW.revision != COALESCE((SELECT MAX(revision) FROM revisions WHERE entry_id=NEW.entry_id),0)+1
    OR NOT EXISTS (SELECT 1 FROM entries WHERE id=NEW.entry_id AND creator_id=NEW.actor_id
      AND (revision=NEW.revision-1 OR (NEW.revision=1 AND revision=1)))
    THEN RAISE(ABORT, 'A sequential revision by the original creator is required') END;
  SELECT CASE WHEN length(trim(NEW.reason))=0 OR NOT json_valid(NEW.payload_json)
    THEN RAISE(ABORT, 'A correction reason and valid JSON revision are required') END;
END;
--> statement-breakpoint
CREATE TRIGGER entries_immutable_delete BEFORE DELETE ON entries
BEGIN SELECT RAISE(ABORT, 'Financial entries are immutable; append a correction'); END;
--> statement-breakpoint
CREATE TRIGGER entries_valid_insert BEFORE INSERT ON entries
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM entries WHERE rowid=NEW.rowid OR id=NEW.id)
    THEN RAISE(ABORT, 'Financial entries are append-only') END;
  SELECT CASE WHEN typeof(NEW.revision)!='integer' OR NEW.revision!=1
    OR NOT EXISTS (SELECT 1 FROM memberships WHERE space_id=NEW.space_id AND user_id=NEW.creator_id)
    THEN RAISE(ABORT, 'An initial revision by a space member is required') END;
END;
--> statement-breakpoint
CREATE TRIGGER entries_valid_update BEFORE UPDATE ON entries
BEGIN
  SELECT CASE WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.space_id IS NOT OLD.space_id
    OR NEW.creator_id IS NOT OLD.creator_id OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'Financial entry identity is immutable') END;
  SELECT CASE WHEN typeof(NEW.revision)!='integer' OR NEW.revision!=OLD.revision+1
    OR NOT EXISTS (SELECT 1 FROM revisions WHERE entry_id=OLD.id AND revision=NEW.revision)
    THEN RAISE(ABORT, 'Entry revision must advance to the next saved revision') END;
END;
--> statement-breakpoint
CREATE TRIGGER audit_immutable_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER audit_valid_insert BEFORE INSERT ON audit_events
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM audit_events WHERE rowid=NEW.rowid OR id=NEW.id)
    THEN RAISE(ABORT, 'Audit events are append-only') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE space_id=NEW.space_id AND user_id=NEW.actor_id)
    OR (NEW.entry_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM entries e JOIN revisions r ON r.entry_id=e.id
       WHERE e.id=NEW.entry_id AND e.space_id=NEW.space_id AND r.revision=NEW.revision))
    OR NOT json_valid(NEW.metadata_json)
    THEN RAISE(ABORT, 'Audit event must reference a valid space member and revision') END;
END;
--> statement-breakpoint
CREATE TRIGGER spaces_immutable_identity BEFORE UPDATE ON spaces
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id
  OR NEW.currency IS NOT OLD.currency OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'Space identity and currency are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER spaces_no_replace BEFORE INSERT ON spaces
WHEN EXISTS (SELECT 1 FROM spaces WHERE rowid=NEW.rowid OR id=NEW.id OR code=NEW.code)
BEGIN SELECT RAISE(ABORT, 'Space identity cannot be replaced'); END;
--> statement-breakpoint
CREATE TRIGGER spaces_code_no_replace BEFORE UPDATE OF code ON spaces
WHEN EXISTS (SELECT 1 FROM spaces WHERE code=NEW.code AND id!=OLD.id)
BEGIN SELECT RAISE(ABORT, 'An invitation code cannot replace another space'); END;
