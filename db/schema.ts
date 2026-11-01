import { sqliteTable, text, integer, primaryKey, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id:text('id').primaryKey(), username:text('username').notNull().unique(), displayName:text('display_name').notNull(),
  authType:text('auth_type', {enum:['password','chatgpt']}).notNull(), passwordHash:text('password_hash'),
  chatgptId:text('chatgpt_id').unique(), createdAt:text('created_at').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash:text('token_hash').primaryKey(), userId:text('user_id').notNull().references(()=>users.id), expiresAt:integer('expires_at').notNull(), createdAt:text('created_at').notNull(),
}, t=>[index('sessions_user_idx').on(t.userId),index('sessions_expiry_idx').on(t.expiresAt)]);
export const loginAttempts = sqliteTable('login_attempts', {
  key:text('key').primaryKey(), attempts:integer('attempts').notNull(), resetAt:integer('reset_at').notNull(),
});
export const spaces = sqliteTable('spaces', {
  id:text('id').primaryKey(), name:text('name').notNull(), ownerId:text('owner_id').notNull().references(()=>users.id),
  code:text('code').notNull().unique(), currency:text('currency').notNull().default('NPR'), createdAt:text('created_at').notNull(),
  ledgerVersion:integer('ledger_version').notNull().default(0),
});
export const memberships = sqliteTable('memberships', {
  spaceId:text('space_id').notNull().references(()=>spaces.id), userId:text('user_id').notNull().references(()=>users.id),
  role:text('role',{enum:['owner','member']}).notNull(), joinedAt:text('joined_at').notNull(),
},t=>[primaryKey({columns:[t.spaceId,t.userId]}),index('memberships_user_idx').on(t.userId)]);
export const entries = sqliteTable('entries', {
  id:text('id').primaryKey(), spaceId:text('space_id').notNull().references(()=>spaces.id), creatorId:text('creator_id').notNull().references(()=>users.id),
  revision:integer('revision').notNull(), createdAt:text('created_at').notNull(),
},t=>[index('entries_space_idx').on(t.spaceId),check('entries_positive_revision',sql`${t.revision} > 0`)]);
export const revisions = sqliteTable('revisions', {
  entryId:text('entry_id').notNull().references(()=>entries.id), revision:integer('revision').notNull(), payloadJson:text('payload_json').notNull(),
  reason:text('reason').notNull(), actorId:text('actor_id').notNull().references(()=>users.id), createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.entryId,t.revision]})]);
export const reviews = sqliteTable('reviews', {
  entryId:text('entry_id').notNull().references(()=>entries.id), revision:integer('revision').notNull(), userId:text('user_id').notNull().references(()=>users.id),
  status:text('status',{enum:['pending','accepted','disputed']}).notNull(), reason:text('reason').notNull(),
},t=>[primaryKey({columns:[t.entryId,t.revision,t.userId]})]);
export const disputes = sqliteTable('disputes', {
  id:text('id').primaryKey(), entryId:text('entry_id').notNull().references(()=>entries.id), userId:text('user_id').notNull().references(()=>users.id),
  openedRevision:integer('opened_revision').notNull(), reason:text('reason').notNull(), resolvedRevision:integer('resolved_revision'),
},t=>[index('disputes_entry_idx').on(t.entryId)]);
export const notifications = sqliteTable('notifications', {
  id:text('id').primaryKey(), spaceId:text('space_id').notNull().references(()=>spaces.id), entryId:text('entry_id').notNull().references(()=>entries.id),
  revision:integer('revision').notNull(), recipientId:text('recipient_id').notNull().references(()=>users.id), actorId:text('actor_id').notNull().references(()=>users.id),
  type:text('type',{enum:['added','revised','disputed','resolved']}).notNull(), reason:text('reason').notNull(),createdAt:text('created_at').notNull(),readAt:text('read_at'),
},t=>[index('notifications_recipient_space_idx').on(t.recipientId,t.spaceId)]);
export const auditEvents = sqliteTable('audit_events', {
  id:text('id').primaryKey(), spaceId:text('space_id').notNull().references(()=>spaces.id), entryId:text('entry_id').references(()=>entries.id),
  actorId:text('actor_id').notNull().references(()=>users.id),action:text('action').notNull(),revision:integer('revision'),metadataJson:text('metadata_json').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('audit_space_idx').on(t.spaceId)]);
// An INSERT + DELETE within a D1 batch asserts its revision precondition atomically.
// A false precondition violates NOT NULL, rolling back every statement in that batch.
export const mutationGuards = sqliteTable('mutation_guards', {
  id:text('id').primaryKey(),ok:integer('ok').notNull(),
});
