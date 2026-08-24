/**
 * Field Operations Console: transparent, deterministic review rules.
 * Thresholds are prototype policy settings; every rule returns observed and expected values for review.
 */
export type RuleCategory = "price" | "quantity" | "logistics" | "quality";
export type RuleSeverity = "info" | "warning" | "high";

export type RuleAnomaly = {
  category: RuleCategory;
  severity: RuleSeverity;
  observedValue: string;
  expectedValue: string;
  deltaPercent?: number;
  explanation: string;
};

type EventForRules = {
  eventType: string;
  pricePerKg?: number;
  quantityKg?: number;
  transitHours?: number;
  temperatureBreachMinutes?: number;
};

type RuleContext = {
  event: EventForRules;
  previousQuantityKg?: number;
  marketReference?: { minPricePerKg: number; maxPricePerKg: number; sourceLabel: string };
};

const formatNumber = (value: number) => Number(value.toFixed(2)).toString();

export function evaluateAnomalies({ event, previousQuantityKg, marketReference }: RuleContext): RuleAnomaly[] {
  const findings: RuleAnomaly[] = [];

  if (event.pricePerKg !== undefined && marketReference && event.pricePerKg < marketReference.minPricePerKg) {
    const deltaPercent = ((marketReference.minPricePerKg - event.pricePerKg) / marketReference.minPricePerKg) * 100;
    findings.push({
      category: "price",
      severity: deltaPercent >= 25 ? "high" : "warning",
      observedValue: `₹${formatNumber(event.pricePerKg)}/kg`,
      expectedValue: `₹${formatNumber(marketReference.minPricePerKg)}–${formatNumber(marketReference.maxPricePerKg)}/kg`,
      deltaPercent,
      explanation: `The recorded offer is ${formatNumber(deltaPercent)}% below the displayed ${marketReference.sourceLabel} reference floor. Review the context; this rule is not proof of wrongdoing.`,
    });
  }

  if (event.quantityKg !== undefined && previousQuantityKg !== undefined && event.quantityKg < previousQuantityKg) {
    const lossPercent = ((previousQuantityKg - event.quantityKg) / previousQuantityKg) * 100;
    if (lossPercent > 5) {
      findings.push({
        category: "quantity",
        severity: lossPercent >= 10 ? "high" : "warning",
        observedValue: `${formatNumber(event.quantityKg)} kg`,
        expectedValue: `≥${formatNumber(previousQuantityKg * 0.95)} kg`,
        deltaPercent: lossPercent,
        explanation: `The recorded quantity is ${formatNumber(lossPercent)}% below the previous physical handoff. The prototype review threshold is 5% shrinkage.`,
      });
    }
  }

  if (event.transitHours !== undefined && event.transitHours > 8) {
    const deltaPercent = ((event.transitHours - 8) / 8) * 100;
    findings.push({
      category: "logistics",
      severity: event.transitHours >= 16 ? "high" : "warning",
      observedValue: `${formatNumber(event.transitHours)}h transit`,
      expectedValue: "≤8h transit",
      deltaPercent,
      explanation: `Transit exceeds the 8-hour prototype route expectation by ${formatNumber(event.transitHours - 8)} hours.`,
    });
  }

  if (event.temperatureBreachMinutes !== undefined && event.temperatureBreachMinutes > 30) {
    const deltaPercent = ((event.temperatureBreachMinutes - 30) / 30) * 100;
    findings.push({
      category: "quality",
      severity: event.temperatureBreachMinutes >= 45 ? "high" : "warning",
      observedValue: `${event.temperatureBreachMinutes} min breach`,
      expectedValue: "≤30 min breach",
      deltaPercent,
      explanation: `The recorded temperature breach is ${event.temperatureBreachMinutes - 30} minutes above the prototype cold-chain threshold.`,
    });
  }

  return findings;
}
