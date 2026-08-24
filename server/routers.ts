import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { verifyEventChain } from "./ledger";

const batchCodeSchema = z.object({ batchCode: z.string().min(3).max(64) });
const organizationRoleSchema = z.enum(["farmer", "fpo_operator", "trader", "logistics_operator", "warehouse_operator", "government_investigator", "government_supervisor"]);
const organizationTypeSchema = z.enum(["farm", "fpo", "trader", "logistics", "warehouse", "government"]);
const batchEventSchema = z.object({
  batchId: z.number().int().positive(),
  eventCode: z.string().min(6).max(64),
  eventType: z.enum(["harvest", "collection", "quality_inspection", "trader_offer", "transit", "warehouse_receipt", "retail_receipt"]),
  actorLabel: z.string().min(2).max(160),
  sourceKind: z.enum(["manual", "sensor", "inspector", "system"]).default("manual"),
  location: z.string().min(2).max(180),
  occurredAt: z.coerce.date(),
  quantityKg: z.number().positive().optional(),
  pricePerKg: z.number().positive().optional(),
  qualityGrade: z.string().min(1).max(40).optional(),
  transitHours: z.number().nonnegative().optional(),
  temperatureBreachMinutes: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  actorOrganizationId: z.number().int().positive().optional(),
});

function notFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  organization: router({
    listMine: protectedProcedure.query(({ ctx }) => db.listOrganizationsForUser(ctx.user.id)),
    members: protectedProcedure.input(z.object({ organizationId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      if (!await db.userCanManageOrganization(input.organizationId, ctx.user.id, ctx.user.role === "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can view its member directory" });
      }
      return db.listOrganizationMembers(input.organizationId);
    }),
    addExistingMember: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), email: z.string().email().max(320), role: organizationRoleSchema })).mutation(async ({ input, ctx }) => {
      if (!await db.userCanManageOrganization(input.organizationId, ctx.user.id, ctx.user.role === "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can assign members" });
      }
      const membership = await db.addExistingUserToOrganization(input);
      if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "No signed-in AgriTrace user has that email address yet" });
      return membership;
    }),
    directory: protectedProcedure.query(() => db.listOrganizationsDirectory()),
    create: protectedProcedure.input(z.object({
      name: z.string().min(2).max(160), type: organizationTypeSchema, role: organizationRoleSchema,
      district: z.string().min(2).max(100).optional(), state: z.string().min(2).max(100).optional(),
    })).mutation(({ input, ctx }) => db.createOrganizationWithMembership({ ...input, userId: ctx.user.id })),
    requestMembership: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), requestedRole: organizationRoleSchema })).mutation(async ({ input, ctx }) => {
      const existing = await db.getOrganizationMembershipForUser(input.organizationId, ctx.user.id);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "You are already an active member of this organization" });
      return db.requestOrganizationMembership({ ...input, requesterUserId: ctx.user.id });
    }),
    myMembershipRequests: protectedProcedure.query(({ ctx }) => db.listMembershipRequestsForUser(ctx.user.id)),
    ownerMembershipRequests: protectedProcedure.query(({ ctx }) => db.listMembershipRequestsForOwner(ctx.user.id)),
    reviewMembershipRequest: protectedProcedure.input(z.object({ requestId: z.number().int().positive(), approved: z.boolean() })).mutation(async ({ input, ctx }) => {
      const request = await db.getMembershipRequest(input.requestId);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Membership request not found" });
      if (ctx.user.role !== "admin" && request.organization.createdById !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can review this request" });
      }
      return db.reviewMembershipRequest({ ...input, reviewerUserId: ctx.user.id });
    }),
    attachToBatch: protectedProcedure.input(z.object({
      batchId: z.number().int().positive(), organizationId: z.number().int().positive(),
      access: z.enum(["owner", "collaborator", "observer"]).default("collaborator"),
    })).mutation(async ({ input, ctx }) => {
      const batchAccess = await db.getBatchAccess(input.batchId, ctx.user.id, ctx.user.role === "admin");
      if (!batchAccess || (batchAccess.source !== "owner" && batchAccess.source !== "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the batch owner can assign a participating organization" });
      }
      return db.attachBatchParticipant(input);
    }),
  }),
  government: router({
    caseQueue: protectedProcedure.query(async ({ ctx }) => {
      if (!await db.userCanReviewGovernmentCases(ctx.user.id, ctx.user.role === "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Government case review access is required" });
      }
      return db.listGovernmentCaseQueue();
    }),
    resolveCase: protectedProcedure.input(z.object({ anomalyId: z.number().int().positive(), resolutionNote: z.string().min(4).max(1000) })).mutation(async ({ input, ctx }) => {
      if (!await db.userCanReviewGovernmentCases(ctx.user.id, ctx.user.role === "admin")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Government case review access is required" });
      }
      const resolved = await db.resolveGovernmentCase({ ...input, reviewerUserId: ctx.user.id });
      if (!resolved) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      return resolved;
    }),
  }),
  batch: router({
    /** Temporary onboarding fixture. It is operationally scoped to the authenticated user. */
    demo: protectedProcedure.query(({ ctx }) => db.ensureDemoScenario(ctx.user.id)),
    list: protectedProcedure.query(({ ctx }) => db.listBatchesForUser(ctx.user.id, ctx.user.role === "admin")),
    detail: protectedProcedure.input(batchCodeSchema).query(async ({ input, ctx }) => {
      const detail = await db.getBatchDetailForUser(input.batchCode, ctx.user.id, ctx.user.role === "admin");
      if (!detail) throw notFound();
      return detail;
    }),
    allowedActions: protectedProcedure.input(z.object({ batchId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      const actions = await db.getAllowedBatchActions(input.batchId, ctx.user.id, ctx.user.role === "admin");
      if (!actions) throw notFound();
      return actions;
    }),
    /** Public consumer view. It intentionally omits actor, payload, ownership, and internal case data. */
    publicDetail: publicProcedure.input(batchCodeSchema).query(async ({ input }) => {
      const detail = await db.getPublicBatchDetail(input.batchCode);
      if (!detail) throw notFound();
      return detail;
    }),
    verifyIntegrity: publicProcedure.input(batchCodeSchema).query(async ({ input }) => {
      const publicDetail = await db.getPublicBatchDetail(input.batchCode);
      if (!publicDetail) throw notFound();
      const detail = await db.getBatchDetail(input.batchCode);
      if (!detail) throw notFound();
      return verifyEventChain(detail.events);
    }),
    create: protectedProcedure.input(z.object({
      crop: z.string().min(2).max(80), variety: z.string().max(120).optional(), grade: z.string().max(40).optional(),
      originDistrict: z.string().min(2).max(100), originState: z.string().min(2).max(100),
      producerLabel: z.string().min(2).max(160), harvestQuantityKg: z.number().positive(), occurredAt: z.coerce.date().optional(),
      ownerOrganizationId: z.number().int().positive().optional(),
    })).mutation(async ({ input, ctx }) => {
      let producerLabel = input.producerLabel;
      if (input.ownerOrganizationId) {
        const membership = await db.getOrganizationMembershipForUser(input.ownerOrganizationId, ctx.user.id);
        if (!membership && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be an active member of the batch owner organization" });
        }
        if (ctx.user.role !== "admin" && (membership?.organization.type !== "farm" || membership.membership.role !== "farmer")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "A harvest batch must be registered through an active farmer workspace" });
        }
        if (membership) producerLabel = membership.organization.name;
      }
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const batchCode = `AT-${input.crop.slice(0, 3).toUpperCase()}-${new Date().getUTCFullYear()}-${suffix}`;
      return db.createBatchWithHarvest({ ...input, producerLabel, batchCode, occurredAt: input.occurredAt ?? new Date(), createdById: ctx.user.id });
    }),
    appendEvent: protectedProcedure.input(batchEventSchema).mutation(async ({ input, ctx }) => {
      const access = await db.getBatchAccess(input.batchId, ctx.user.id, ctx.user.role === "admin");
      const canRecord = await db.userCanRecordEvent({ batchId: input.batchId, userId: ctx.user.id, isAdmin: ctx.user.role === "admin", eventType: input.eventType });
      if (!canRecord) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to record this event for the batch" });
      if (access?.source !== "admin" && access?.participantOrganizationId && input.actorOrganizationId !== access.participantOrganizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Use the organization assigned to your batch participation" });
      }
      return db.appendBatchEvent({ ...input, createdById: ctx.user.id });
    }),
  }),
});

export type AppRouter = typeof appRouter;
