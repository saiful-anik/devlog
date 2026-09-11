import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull(),
  details: text("details"),
  resourcePath: text("resource_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const timelineEvents = pgTable("timeline_events", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

export const projectScreenshots = pgTable("project_screenshots", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull().unique(),
  caption: text("caption"),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
