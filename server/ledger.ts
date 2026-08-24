/**
 * Field Operations Console: deterministic SHA-256 evidence-chain helpers.
 * This is tamper-evident application logic, not a claim of a public-chain anchor.
 */
import { createHash } from "node:crypto";

export const GENESIS_HASH = "AGRI-TRACE-GENESIS-V1";

type HashableEvent = {
  batchId: number;
  eventCode: string;
  eventType: string;
  actorLabel: string;
  sourceKind: string;
  location: string;
  occurredAt: Date;
  quantityKg?: number | string | null;
  pricePerKg?: number | string | null;
  qualityGrade?: string | null;
  transitHours?: number | string | null;
  temperatureBreachMinutes?: number | null;
  payloadJson?: string | null;
  previousHash?: string | null;
};

function value(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function decimalValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

/** Stable JSON preserves the same hash even when object key order changes. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function calculateEventHash(event: HashableEvent) {
  const canonical = [
    value(event.previousHash || GENESIS_HASH), value(event.batchId), value(event.eventCode),
    value(event.eventType), value(event.actorLabel), value(event.sourceKind), value(event.location),
    event.occurredAt.toISOString(), decimalValue(event.quantityKg), decimalValue(event.pricePerKg),
    value(event.qualityGrade), decimalValue(event.transitHours), value(event.temperatureBreachMinutes),
    value(event.payloadJson),
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}

export function verifyEventChain(events: Array<HashableEvent & { eventHash: string }>) {
  let previousHash: string | null = null;
  for (const event of events) {
    const expected = calculateEventHash({ ...event, previousHash });
    if (event.previousHash !== previousHash || event.eventHash !== expected) {
      return { valid: false, checked: events.length, failedEventCode: event.eventCode };
    }
    previousHash = event.eventHash;
  }
  return { valid: true, checked: events.length, failedEventCode: null };
}
