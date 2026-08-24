import { decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const organizationTypeValues = ["farm", "fpo", "trader", "logistics", "warehouse", "government"] as const;
export const participantRoleValues = ["farmer", "fpo_operator", "trader", "logistics_operator", "warehouse_operator", "government_investigator", "government_supervisor"] as const;
export const participantAccessValues = ["owner", "collaborator", "observer"] as const;

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** OAuth subject identifier returned from the callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** A real-world participant entity. Users gain operational roles through membership, not global account type. */
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  type: mysqlEnum("type", organizationTypeValues).notNull(),
  district: varchar("district", { length: 100 }),
  state: varchar("state", { length: 100 }),
  createdById: int("createdById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("organizations_type_idx").on(table.type),
  index("organizations_created_by_idx").on(table.createdById),
]);

/** A user can represent one or more supply-chain organizations, with one operational role per organization. */
export const organizationMembers = mysqlTable("organizationMembers", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", participantRoleValues).notNull(),
  status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("organization_members_org_user_idx").on(table.organizationId, table.userId),
  index("organization_members_user_idx").on(table.userId),
]);

/** A free in-app request queue. Owners approve role requests after the requester has authenticated. */
export const membershipRequests = mysqlTable("membershipRequests", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  requesterUserId: int("requesterUserId").notNull(),
  requestedRole: mysqlEnum("requestedRole", participantRoleValues).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedByUserId: int("reviewedByUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
}, (table) => [
  uniqueIndex("membership_requests_org_requester_idx").on(table.organizationId, table.requesterUserId),
  index("membership_requests_org_status_idx").on(table.organizationId, table.status),
  index("membership_requests_requester_idx").on(table.requesterUserId),
]);

/**
 * A traceable agricultural lot. Quantities are stored in kilograms and business timestamps
 * remain UTC timestamps, matching the master-plan’s evidence-led batch flow.
 */
export const batches = mysqlTable("batches", {
  id: int("id").autoincrement().primaryKey(),
  batchCode: varchar("batchCode", { length: 64 }).notNull().unique(),
  crop: varchar("crop", { length: 80 }).notNull(),
  variety: varchar("variety", { length: 120 }),
  grade: varchar("grade", { length: 40 }),
  originDistrict: varchar("originDistrict", { length: 100 }).notNull(),
  originState: varchar("originState", { length: 100 }).notNull(),
  producerLabel: varchar("producerLabel", { length: 160 }).notNull(),
  harvestQuantityKg: decimal("harvestQuantityKg", { precision: 12, scale: 2 }).notNull(),
  currentQuantityKg: decimal("currentQuantityKg", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["draft", "harvested", "collected", "in_transit", "received", "closed"]).default("draft").notNull(),
  createdById: int("createdById"),
  ownerOrganizationId: int("ownerOrganizationId"),
  publicVerificationEnabled: mysqlEnum("publicVerificationEnabled", ["yes", "no"]).default("yes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("batches_status_idx").on(table.status),
  index("batches_created_by_idx").on(table.createdById),
  index("batches_owner_organization_idx").on(table.ownerOrganizationId),
]);

/** Explicit batch access for handoffs and oversight. Role permissions are evaluated from the member record. */
export const batchParticipants = mysqlTable("batchParticipants", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  organizationId: int("organizationId").notNull(),
  access: mysqlEnum("access", participantAccessValues).default("collaborator").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("batch_participants_batch_org_idx").on(table.batchId, table.organizationId),
  index("batch_participants_organization_idx").on(table.organizationId),
]);

/**
 * A tamper-evident event stream. eventHash is calculated from canonical business fields and
 * previousHash, enabling a demonstrable hash chain without claiming a production blockchain anchor.
 */
export const batchEvents = mysqlTable("batchEvents", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  eventCode: varchar("eventCode", { length: 64 }).notNull(),
  eventType: mysqlEnum("eventType", ["harvest", "collection", "quality_inspection", "trader_offer", "transit", "warehouse_receipt", "retail_receipt"]).notNull(),
  actorLabel: varchar("actorLabel", { length: 160 }).notNull(),
  sourceKind: mysqlEnum("sourceKind", ["manual", "sensor", "inspector", "system"]).default("manual").notNull(),
  location: varchar("location", { length: 180 }).notNull(),
  occurredAt: timestamp("occurredAt").notNull(),
  quantityKg: decimal("quantityKg", { precision: 12, scale: 2 }),
  pricePerKg: decimal("pricePerKg", { precision: 10, scale: 2 }),
  qualityGrade: varchar("qualityGrade", { length: 40 }),
  transitHours: decimal("transitHours", { precision: 8, scale: 2 }),
  temperatureBreachMinutes: int("temperatureBreachMinutes"),
  payloadJson: text("payloadJson"),
  previousHash: varchar("previousHash", { length: 64 }),
  eventHash: varchar("eventHash", { length: 64 }).notNull(),
  integrityStatus: mysqlEnum("integrityStatus", ["verified", "review"]).default("verified").notNull(),
  createdById: int("createdById"),
  actorOrganizationId: int("actorOrganizationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("batch_events_code_idx").on(table.eventCode),
  index("batch_events_batch_occurred_idx").on(table.batchId, table.occurredAt),
  index("batch_events_created_by_idx").on(table.createdById),
]);

/** Displayed local reference prices. These are transparent decision inputs, not a claim of live market coverage. */
export const marketReferences = mysqlTable("marketReferences", {
  id: int("id").autoincrement().primaryKey(),
  crop: varchar("crop", { length: 80 }).notNull(),
  market: varchar("market", { length: 140 }).notNull(),
  district: varchar("district", { length: 100 }).notNull(),
  minPricePerKg: decimal("minPricePerKg", { precision: 10, scale: 2 }).notNull(),
  maxPricePerKg: decimal("maxPricePerKg", { precision: 10, scale: 2 }).notNull(),
  sourceLabel: varchar("sourceLabel", { length: 180 }).notNull(),
  effectiveAt: timestamp("effectiveAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("market_reference_crop_district_idx").on(table.crop, table.district)]);

/** Individual, user-reviewable anomaly explanations generated from batch events. */
export const anomalies = mysqlTable("anomalies", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull(),
  batchEventId: int("batchEventId").notNull(),
  category: mysqlEnum("category", ["price", "quantity", "logistics", "quality"]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "high"]).notNull(),
  observedValue: varchar("observedValue", { length: 120 }).notNull(),
  expectedValue: varchar("expectedValue", { length: 120 }).notNull(),
  deltaPercent: decimal("deltaPercent", { precision: 8, scale: 2 }),
  explanation: text("explanation").notNull(),
  status: mysqlEnum("status", ["open", "resolved"]).default("open").notNull(),
  resolutionNote: text("resolutionNote"),
  resolvedById: int("resolvedById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
}, (table) => [
  index("anomalies_batch_status_idx").on(table.batchId, table.status),
  index("anomalies_event_idx").on(table.batchEventId),
]);

export type Batch = typeof batches.$inferSelect;
export type InsertBatch = typeof batches.$inferInsert;
export type BatchEvent = typeof batchEvents.$inferSelect;
export type InsertBatchEvent = typeof batchEvents.$inferInsert;
export type MarketReference = typeof marketReferences.$inferSelect;
export type Anomaly = typeof anomalies.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type BatchParticipant = typeof batchParticipants.$inferSelect;
export type MembershipRequest = typeof membershipRequests.$inferSelect;
