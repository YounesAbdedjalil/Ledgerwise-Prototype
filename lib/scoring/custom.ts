import { CLAIM_TYPES, type ClaimType } from "../import-schema";
import { CRITERIA, type Criterion } from "./config";

export type ScoringConfigResult = {
  criteria: Criterion[];
  source: "default" | "environment";
  warning?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScoringCriteria(raw: string): Criterion[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 12) {
    throw new Error("Scoring configuration must be an array of 1–12 criteria.");
  }

  const keys = new Set<string>();
  const criteria = parsed.map((item, index): Criterion => {
    if (!isRecord(item)) throw new Error(`Criterion ${index + 1} must be an object.`);
    const { key, label, measures, claimType, weight } = item;
    if (typeof key !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(key)) {
      throw new Error(`Criterion ${index + 1} has an invalid key.`);
    }
    if (keys.has(key)) throw new Error(`Duplicate criterion key: ${key}.`);
    keys.add(key);
    if (typeof label !== "string" || !label.trim() || label.length > 80) {
      throw new Error(`Criterion ${key} needs a label of 1–80 characters.`);
    }
    if (typeof measures !== "string" || !measures.trim() || measures.length > 300) {
      throw new Error(`Criterion ${key} needs a description of 1–300 characters.`);
    }
    if (
      typeof claimType !== "string" ||
      !CLAIM_TYPES.includes(claimType as ClaimType) ||
      claimType === "disqualifier" ||
      claimType === "category"
    ) {
      throw new Error(`Criterion ${key} uses an unsupported claimType.`);
    }
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight <= 0 || weight > 100) {
      throw new Error(`Criterion ${key} must have an integer weight from 1 to 100.`);
    }
    return {
      key,
      label: label.trim(),
      measures: measures.trim(),
      claimType: claimType as Criterion["claimType"],
      weight,
    };
  });

  const total = criteria.reduce((sum, criterion) => sum + (criterion.weight ?? 0), 0);
  if (total !== 100) throw new Error(`Scoring weights must total 100; received ${total}.`);
  return criteria;
}

export function getScoringConfig(
  env: Record<string, string | undefined> = process.env,
): ScoringConfigResult {
  const raw = env.LEDGERWISE_SCORING_CRITERIA_JSON?.trim();
  if (!raw) return { criteria: CRITERIA, source: "default" };

  try {
    return { criteria: parseScoringCriteria(raw), source: "environment" };
  } catch (error) {
    return {
      criteria: CRITERIA,
      source: "default",
      warning:
        error instanceof Error
          ? `Custom scoring configuration was ignored: ${error.message}`
          : "Custom scoring configuration was ignored.",
    };
  }
}
