import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { anomalies, batchParticipants, batches, batchEvents, InsertUser, marketReferences, membershipRequests, organizationMembers, organizations, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { calculateEventHash, stableJson } from "./ledger";
import { evaluateAnomalies } from "./rules";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  (["name", "email", "loginMethod"] as const).forEach((field) => {
    if (user[field] !== undefined) {
      const value = user[field] ?? null;
      values[field] = value;
      updateSet[field] = value;
    }
  });
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type ParticipantRole = "farmer" | "fpo_operator" | "trader" | "logistics_operator" | "warehouse_operator" | "government_investigator" | "government_supervisor";

export type CreateBatchInput = {
  batchCode: string;
  crop: string;
  variety?: string;
  grade?: string;
  originDistrict: string;
  originState: string;
  producerLabel: string;
  harvestQuantityKg: number;
  occurredAt: Date;
  createdById?: number;
  ownerOrganizationId?: number;
};

export type AppendEventInput = {
  batchId: number;
  eventCode: string;
  eventType: "harvest" | "collection" | "quality_inspection" | "trader_offer" | "transit" | "warehouse_receipt" | "retail_receipt";
  actorLabel: string;
  sourceKind: "manual" | "sensor" | "inspector" | "system";
  location: string;
  occurredAt: Date;
  quantityKg?: number;
  pricePerKg?: number;
  qualityGrade?: string;
  transitHours?: number;
  temperatureBreachMinutes?: number;
  payload?: Record<string, unknown>;
  createdById?: number;
  actorOrganizationId?: number;
};

export type BatchAccess = {
  batch: typeof batches.$inferSelect;
  source: "owner" | "participant" | "admin";
  participantRole?: ParticipantRole;
  participantAccess?: "owner" | "collaborator" | "observer";
  participantOrganizationId?: number;
};

function nextBatchStatus(eventType: AppendEventInput["eventType"]) {
  if (eventType === "harvest") return "harvested" as const;
  if (eventType === "collection" || eventType === "quality_inspection") return "collected" as const;
  if (eventType === "trader_offer" || eventType === "transit") return "in_transit" as const;
  if (eventType === "warehouse_receipt") return "received" as const;
  return "closed" as const;
}

export async function listBatchesForUser(userId: number, isAdmin = false) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  if (isAdmin) return db.select().from(batches).orderBy(desc(batches.updatedAt));
  const owned = await db.select().from(batches).where(eq(batches.createdById, userId)).orderBy(desc(batches.updatedAt));
  const participantRows = await db.select({ batch: batches }).from(batchParticipants)
    .innerJoin(organizationMembers, eq(batchParticipants.organizationId, organizationMembers.organizationId))
    .innerJoin(batches, eq(batchParticipants.batchId, batches.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(desc(batches.updatedAt));
  const byId = new Map(owned.map((batch) => [batch.id, batch]));
  participantRows.forEach(({ batch }) => byId.set(batch.id, batch));
  return Array.from(byId.values()).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function getBatchByCode(batchCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(batches).where(eq(batches.batchCode, batchCode)).limit(1);
  return result[0];
}

export async function getBatchDetail(batchCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const batch = await getBatchByCode(batchCode);
  if (!batch) return undefined;
  const events = await db.select().from(batchEvents).where(eq(batchEvents.batchId, batch.id)).orderBy(batchEvents.occurredAt, batchEvents.id);
  const anomalyRows = await db.select().from(anomalies).where(eq(anomalies.batchId, batch.id)).orderBy(anomalies.createdAt, anomalies.id);
  return { batch, events, anomalies: anomalyRows };
}

export async function getBatchAccess(batchId: number, userId: number, isAdmin = false): Promise<BatchAccess | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const batchRows = await db.select().from(batches).where(eq(batches.id, batchId)).limit(1);
  const batch = batchRows[0];
  if (!batch) return undefined;
  if (isAdmin) return { batch, source: "admin" };
  if (batch.createdById === userId) {
    const ownerMembership = batch.ownerOrganizationId ? await db.select({ role: organizationMembers.role }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, batch.ownerOrganizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
      .limit(1) : [];
    return {
      batch,
      source: "owner",
      participantRole: ownerMembership[0]?.role as ParticipantRole | undefined,
      participantAccess: "owner",
      participantOrganizationId: batch.ownerOrganizationId ?? undefined,
    };
  }
  const memberships = await db.select({ role: organizationMembers.role, access: batchParticipants.access, organizationId: organizationMembers.organizationId }).from(batchParticipants)
    .innerJoin(organizationMembers, eq(batchParticipants.organizationId, organizationMembers.organizationId))
    .where(and(
      eq(batchParticipants.batchId, batchId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, "active"),
    )).limit(1);
  const membership = memberships[0];
  return membership ? { batch, source: "participant", participantRole: membership.role as ParticipantRole, participantAccess: membership.access, participantOrganizationId: membership.organizationId } : undefined;
}

export async function getBatchDetailForUser(batchCode: string, userId: number, isAdmin = false) {
  const batch = await getBatchByCode(batchCode);
  if (!batch) return undefined;
  const access = await getBatchAccess(batch.id, userId, isAdmin);
  if (!access) return undefined;
  const detail = await getBatchDetail(batchCode);
  return detail ? { ...detail, access } : undefined;
}

/** Consumer-safe view with no actor labels, staff IDs, payload fields, or internal case state. */
export async function getPublicBatchDetail(batchCode: string) {
  const detail = await getBatchDetail(batchCode);
  if (!detail || detail.batch.publicVerificationEnabled !== "yes") return undefined;
  const { batch, events, anomalies: anomalyRows } = detail;
  return {
    batch: {
      batchCode: batch.batchCode, crop: batch.crop, variety: batch.variety, grade: batch.grade,
      originDistrict: batch.originDistrict, originState: batch.originState, harvestQuantityKg: batch.harvestQuantityKg,
      currentQuantityKg: batch.currentQuantityKg, status: batch.status, createdAt: batch.createdAt,
    },
    events: events.map((event) => ({
      id: event.id, eventCode: event.eventCode, eventType: event.eventType, location: event.location,
      occurredAt: event.occurredAt, quantityKg: event.quantityKg, pricePerKg: event.pricePerKg,
      qualityGrade: event.qualityGrade, transitHours: event.transitHours,
      temperatureBreachMinutes: event.temperatureBreachMinutes, integrityStatus: event.integrityStatus,
    })),
    anomalies: anomalyRows.map((anomaly) => ({
      id: anomaly.id, batchEventId: anomaly.batchEventId, category: anomaly.category, severity: anomaly.severity,
      observedValue: anomaly.observedValue, expectedValue: anomaly.expectedValue, explanation: anomaly.explanation,
    })),
  };
}

export const roleAllowedEvents: Record<ParticipantRole, AppendEventInput["eventType"][]> = {
  farmer: ["harvest"],
  fpo_operator: ["collection", "quality_inspection"],
  trader: ["trader_offer"],
  logistics_operator: ["transit"],
  warehouse_operator: ["warehouse_receipt", "retail_receipt"],
  government_investigator: [],
  government_supervisor: [],
};

export async function getAllowedBatchActions(batchId: number, userId: number, isAdmin = false) {
  const access = await getBatchAccess(batchId, userId, isAdmin);
  if (!access) return undefined;
  const allEvents: AppendEventInput["eventType"][] = ["harvest", "collection", "quality_inspection", "trader_offer", "transit", "warehouse_receipt", "retail_receipt"];
  if (access.source === "admin") return { access, eventTypes: allEvents };
  if (access.participantAccess === "observer") return { access, eventTypes: [] as AppendEventInput["eventType"][] };
  if (access.source === "owner" && !access.participantRole) return { access, eventTypes: allEvents };
  return { access, eventTypes: access.participantRole ? roleAllowedEvents[access.participantRole] : [] };
}

export async function userCanRecordEvent(input: { batchId: number; userId: number; isAdmin: boolean; eventType: AppendEventInput["eventType"] }) {
  const access = await getBatchAccess(input.batchId, input.userId, input.isAdmin);
  if (!access || access.participantAccess === "observer") return false;
  if (access.source === "admin") return true;
  /** Legacy creator-only batches keep their original write behavior until they are assigned an organization. */
  if (access.source === "owner" && !access.participantRole) return true;
  return Boolean(access.participantRole && roleAllowedEvents[access.participantRole].includes(input.eventType));
}

export async function createBatchWithHarvest(input: CreateBatchInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const inserted = await db.insert(batches).values({
    batchCode: input.batchCode,
    crop: input.crop,
    variety: input.variety || null,
    grade: input.grade || null,
    originDistrict: input.originDistrict,
    originState: input.originState,
    producerLabel: input.producerLabel,
    harvestQuantityKg: String(input.harvestQuantityKg),
    currentQuantityKg: String(input.harvestQuantityKg),
    status: "harvested",
    createdById: input.createdById,
    ownerOrganizationId: input.ownerOrganizationId,
  });
  const batchId = Number(inserted[0].insertId);
  const eventCode = `${input.batchCode}-HVST-001`;
  const payloadJson = stableJson({ record: "initial_harvest", batchCode: input.batchCode });
  const eventHash = calculateEventHash({
    batchId, eventCode, eventType: "harvest", actorLabel: input.producerLabel,
    sourceKind: "manual", location: `${input.originDistrict}, ${input.originState}`,
    occurredAt: input.occurredAt, quantityKg: input.harvestQuantityKg, payloadJson, previousHash: null,
  });
  await db.insert(batchEvents).values({
    batchId, eventCode, eventType: "harvest", actorLabel: input.producerLabel,
    sourceKind: "manual", location: `${input.originDistrict}, ${input.originState}`,
    occurredAt: input.occurredAt, quantityKg: String(input.harvestQuantityKg),
    payloadJson, previousHash: null, eventHash, integrityStatus: "verified",
    createdById: input.createdById, actorOrganizationId: input.ownerOrganizationId,
  });
  if (input.ownerOrganizationId) {
    await db.insert(batchParticipants).values({ batchId, organizationId: input.ownerOrganizationId, access: "owner" });
  }
  return getBatchDetail(input.batchCode);
}

export async function appendBatchEvent(input: AppendEventInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const batchRows = await db.select().from(batches).where(eq(batches.id, input.batchId)).limit(1);
  const batch = batchRows[0];
  if (!batch) throw new Error("Batch not found");
  const priorEvents = await db.select().from(batchEvents).where(eq(batchEvents.batchId, input.batchId)).orderBy(desc(batchEvents.id));
  const previousQuantity = priorEvents.find((event) => event.quantityKg !== null)?.quantityKg;
  const references = await db.select().from(marketReferences).where(and(
    eq(marketReferences.crop, batch.crop), eq(marketReferences.district, batch.originDistrict),
  )).orderBy(desc(marketReferences.effectiveAt)).limit(1);
  const previousHash = priorEvents[0]?.eventHash ?? null;
  const payloadJson = input.payload ? stableJson(input.payload) : null;
  const eventHash = calculateEventHash({ ...input, payloadJson, previousHash });
  await db.insert(batchEvents).values({
    batchId: input.batchId, eventCode: input.eventCode, eventType: input.eventType,
    actorLabel: input.actorLabel, sourceKind: input.sourceKind, location: input.location,
    occurredAt: input.occurredAt, quantityKg: input.quantityKg === undefined ? null : String(input.quantityKg),
    pricePerKg: input.pricePerKg === undefined ? null : String(input.pricePerKg),
    qualityGrade: input.qualityGrade || null, transitHours: input.transitHours === undefined ? null : String(input.transitHours),
    temperatureBreachMinutes: input.temperatureBreachMinutes ?? null, payloadJson, previousHash,
    eventHash, integrityStatus: "verified", createdById: input.createdById, actorOrganizationId: input.actorOrganizationId,
  });
  const update: { status: ReturnType<typeof nextBatchStatus>; currentQuantityKg?: string } = { status: nextBatchStatus(input.eventType) };
  if (input.quantityKg !== undefined) update.currentQuantityKg = String(input.quantityKg);
  await db.update(batches).set(update).where(eq(batches.id, input.batchId));
  const inserted = await db.select().from(batchEvents).where(eq(batchEvents.eventCode, input.eventCode)).limit(1);
  const event = inserted[0];
  if (!event) throw new Error("Event was not found after insert");
  const reference = references[0];
  const findings = evaluateAnomalies({
    previousQuantityKg: previousQuantity === null || previousQuantity === undefined ? undefined : Number(previousQuantity),
    marketReference: reference ? { minPricePerKg: Number(reference.minPricePerKg), maxPricePerKg: Number(reference.maxPricePerKg), sourceLabel: reference.sourceLabel } : undefined,
    event: { eventType: input.eventType, pricePerKg: input.pricePerKg, quantityKg: input.quantityKg, transitHours: input.transitHours, temperatureBreachMinutes: input.temperatureBreachMinutes },
  });
  if (findings.length) {
    await db.insert(anomalies).values(findings.map((finding) => ({
      batchId: input.batchId, batchEventId: event.id, category: finding.category, severity: finding.severity,
      observedValue: finding.observedValue, expectedValue: finding.expectedValue,
      deltaPercent: finding.deltaPercent === undefined ? null : String(finding.deltaPercent), explanation: finding.explanation,
    })));
  }
  return { event, findings };
}

export type OrganizationType = "farm" | "fpo" | "trader" | "logistics" | "warehouse" | "government";

export async function listOrganizationsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ organization: organizations, membership: organizationMembers }).from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(desc(organizations.updatedAt));
}

/** Organization-level routing directory for owners assigning a legitimate supply-chain handoff. */
export async function listOrganizationsDirectory() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ id: organizations.id, name: organizations.name, type: organizations.type, district: organizations.district, state: organizations.state })
    .from(organizations)
    .orderBy(organizations.name);
}

export async function getOrganizationMembershipForUser(organizationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const memberships = await db.select({ organization: organizations, membership: organizationMembers }).from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .limit(1);
  return memberships[0];
}

export async function userCanManageOrganization(organizationId: number, userId: number, isAdmin = false) {
  if (isAdmin) return true;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const organization = await db.select({ createdById: organizations.createdById }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return organization[0]?.createdById === userId;
}

export async function listOrganizationMembers(organizationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ member: organizationMembers, user: users }).from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(organizationMembers.createdAt);
}

export async function addExistingUserToOrganization(input: { organizationId: number; email: string; role: ParticipantRole }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const organization = await db.select({ type: organizations.type }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
  const roleByType: Record<OrganizationType, ParticipantRole[]> = {
    farm: ["farmer"], fpo: ["fpo_operator"], trader: ["trader"], logistics: ["logistics_operator"], warehouse: ["warehouse_operator"], government: ["government_investigator", "government_supervisor"],
  };
  if (!organization[0] || !roleByType[organization[0].type as OrganizationType].includes(input.role)) {
    throw new Error("The selected role does not match this organization type");
  }
  const target = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase())).limit(1);
  if (!target[0]) return undefined;
  await db.insert(organizationMembers).values({ organizationId: input.organizationId, userId: target[0].id, role: input.role, status: "active" })
    .onDuplicateKeyUpdate({ set: { role: input.role, status: "active" } });
  return getOrganizationMembershipForUser(input.organizationId, target[0].id);
}

export async function userCanReviewGovernmentCases(userId: number, isAdmin = false) {
  if (isAdmin) return true;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const memberships = await db.select({ role: organizationMembers.role }).from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, "active"),
      eq(organizations.type, "government"),
    ));
  return memberships.some((membership) => membership.role === "government_investigator" || membership.role === "government_supervisor");
}

export async function listGovernmentCaseQueue() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ anomaly: anomalies, batch: batches, event: batchEvents }).from(anomalies)
    .innerJoin(batches, eq(anomalies.batchId, batches.id))
    .innerJoin(batchEvents, eq(anomalies.batchEventId, batchEvents.id))
    .orderBy(desc(anomalies.createdAt));
}

export async function resolveGovernmentCase(input: { anomalyId: number; reviewerUserId: number; resolutionNote: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(anomalies).set({ status: "resolved", resolutionNote: input.resolutionNote, resolvedById: input.reviewerUserId, resolvedAt: new Date() })
    .where(eq(anomalies.id, input.anomalyId));
  const result = await db.select().from(anomalies).where(eq(anomalies.id, input.anomalyId)).limit(1);
  return result[0];
}

export async function createOrganizationWithMembership(input: { name: string; type: OrganizationType; district?: string; state?: string; userId: number; role: ParticipantRole }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const inserted = await db.insert(organizations).values({
    name: input.name, type: input.type, district: input.district || null, state: input.state || null, createdById: input.userId,
  });
  const organizationId = Number(inserted[0].insertId);
  await db.insert(organizationMembers).values({ organizationId, userId: input.userId, role: input.role, status: "active" });
  return getOrganizationMembershipForUser(organizationId, input.userId);
}

export async function attachBatchParticipant(input: { batchId: number; organizationId: number; access: "owner" | "collaborator" | "observer" }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(batchParticipants).values(input).onDuplicateKeyUpdate({ set: { access: input.access } });
  return input;
}

export async function requestOrganizationMembership(input: { organizationId: number; requesterUserId: number; requestedRole: ParticipantRole }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(membershipRequests).values({
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
    requestedRole: input.requestedRole,
    status: "pending",
  }).onDuplicateKeyUpdate({
    set: { requestedRole: input.requestedRole, status: "pending", reviewedByUserId: null, reviewedAt: null },
  });
  const requests = await db.select().from(membershipRequests).where(and(
    eq(membershipRequests.organizationId, input.organizationId),
    eq(membershipRequests.requesterUserId, input.requesterUserId),
  )).limit(1);
  return requests[0];
}

export async function listMembershipRequestsForOwner(ownerUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ request: membershipRequests, organization: organizations, requester: { id: users.id, name: users.name, email: users.email } })
    .from(membershipRequests)
    .innerJoin(organizations, eq(membershipRequests.organizationId, organizations.id))
    .innerJoin(users, eq(membershipRequests.requesterUserId, users.id))
    .where(and(eq(organizations.createdById, ownerUserId), eq(membershipRequests.status, "pending")))
    .orderBy(desc(membershipRequests.createdAt));
}

export async function listMembershipRequestsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select({ request: membershipRequests, organization: organizations })
    .from(membershipRequests)
    .innerJoin(organizations, eq(membershipRequests.organizationId, organizations.id))
    .where(eq(membershipRequests.requesterUserId, userId))
    .orderBy(desc(membershipRequests.createdAt));
}

export async function getMembershipRequest(requestId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const requests = await db.select({ request: membershipRequests, organization: organizations }).from(membershipRequests)
    .innerJoin(organizations, eq(membershipRequests.organizationId, organizations.id))
    .where(eq(membershipRequests.id, requestId)).limit(1);
  return requests[0];
}

export async function reviewMembershipRequest(input: { requestId: number; reviewerUserId: number; approved: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const requestWithOrganization = await getMembershipRequest(input.requestId);
  if (!requestWithOrganization) throw new Error("Membership request not found");
  const { request } = requestWithOrganization;
  const status = input.approved ? "approved" as const : "rejected" as const;
  if (input.approved) {
    await db.insert(organizationMembers).values({
      organizationId: request.organizationId,
      userId: request.requesterUserId,
      role: request.requestedRole,
      status: "active",
    }).onDuplicateKeyUpdate({ set: { role: request.requestedRole, status: "active" } });
  }
  await db.update(membershipRequests).set({ status, reviewedByUserId: input.reviewerUserId, reviewedAt: new Date() })
    .where(eq(membershipRequests.id, input.requestId));
  return getMembershipRequest(input.requestId);
}

/** Persistent review scenario, explicitly labeled as prototype market and sensor data in the UI. */
export async function ensureDemoScenario(createdById?: number) {
  const code = "ODS-TOM-2026-008421";
  const existing = await getBatchDetail(code);
  if (existing) {
    if (createdById && existing.batch.createdById === null) {
      const db = await getDb();
      if (db) await db.update(batches).set({ createdById }).where(eq(batches.id, existing.batch.id));
      return getBatchDetail(code);
    }
    return existing;
  }
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(marketReferences).values({
    crop: "Tomato", market: "Bhubaneswar mandi", district: "Khordha", minPricePerKg: "27.00", maxPricePerKg: "30.00",
    sourceLabel: "prototype market reference (not live market data)", effectiveAt: new Date("2026-08-15T00:00:00.000Z"),
  });
  const created = await createBatchWithHarvest({
    batchCode: code, crop: "Tomato", variety: "Hybrid", grade: "Grade A", originDistrict: "Khordha", originState: "Odisha",
    producerLabel: "FPO-1042", harvestQuantityKg: 1000, occurredAt: new Date("2026-08-14T08:14:00.000Z"), createdById,
  });
  if (!created) throw new Error("Demo batch could not be created");
  const batchId = created.batch.id;
  await appendBatchEvent({ batchId, eventCode: `${code}-COLL-002`, eventType: "collection", actorLabel: "FPO-1042", sourceKind: "manual", location: "Khordha collection", occurredAt: new Date("2026-08-14T11:42:00.000Z"), quantityKg: 980, payload: { note: "collection count" }, createdById });
  await appendBatchEvent({ batchId, eventCode: `${code}-INSP-003`, eventType: "quality_inspection", actorLabel: "Verified inspector", sourceKind: "inspector", location: "Bhubaneswar FPO", occurredAt: new Date("2026-08-15T07:20:00.000Z"), qualityGrade: "Grade A", payload: { certificateReference: "QI-48A" }, createdById });
  await appendBatchEvent({ batchId, eventCode: `${code}-OFR-004`, eventType: "trader_offer", actorLabel: "Authenticated trader", sourceKind: "manual", location: "Bhubaneswar mandi", occurredAt: new Date("2026-08-15T10:05:00.000Z"), pricePerKg: 18, payload: { offerCurrency: "INR" }, createdById });
  await appendBatchEvent({ batchId, eventCode: `${code}-TRN-005`, eventType: "transit", actorLabel: "Simulated sensor feed", sourceKind: "sensor", location: "Khordha → Bhubaneswar", occurredAt: new Date("2026-08-16T04:10:00.000Z"), transitHours: 18, temperatureBreachMinutes: 47, payload: { expectedTransitHours: 8, isPrototypeSensorFeed: true }, createdById });
  await appendBatchEvent({ batchId, eventCode: `${code}-WHR-006`, eventType: "warehouse_receipt", actorLabel: "Warehouse entry", sourceKind: "manual", location: "Bhubaneswar warehouse", occurredAt: new Date("2026-08-16T08:18:00.000Z"), quantityKg: 850, payload: { receiptReference: "WH-BBS-991" }, createdById });
  const detail = await getBatchDetail(code);
  if (!detail) throw new Error("Demo batch could not be loaded");
  return detail;
}
