import { CRITERIA, type Criterion } from "./config";

export type SourceRow = {
  id: string;
  claim: string;
  claim_type: string;
  source_url: string;
  source_title: string;
  retrieved_at: string;
  evidence: string;
  verification_status?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

export type CriterionResult = {
  criterion: Criterion;
  met: boolean;
  points: number | null; // null while the weight is not set
  reason: string; // built only from stored claims
  sources: SourceRow[]; // every reason is traceable to these
};

export type ScoreResult = {
  criteria: CriterionResult[];
  disqualifiers: SourceRow[];
  weightsComplete: boolean;
  total: number | null; // null until every weight is set
  maxTotal: number | null;
};

export function scoreCompany(
  sources: SourceRow[],
  criteria: Criterion[] = CRITERIA
): ScoreResult {
  const weightsComplete = criteria.every((c) => c.weight !== null);

  const results: CriterionResult[] = criteria.map((criterion) => {
    const matched = sources.filter((s) => s.claim_type === criterion.claimType);
    const met = matched.length > 0;
    const points =
      criterion.weight === null ? null : met ? criterion.weight : 0;
    const reason = met
      ? matched.map((s) => s.claim).join("; ")
      : "No sourced evidence recorded (unknown)";
    return { criterion, met, points, reason, sources: matched };
  });

  return {
    criteria: results,
    disqualifiers: sources.filter((s) => s.claim_type === "disqualifier"),
    weightsComplete,
    total: weightsComplete
      ? results.reduce((sum, r) => sum + (r.points ?? 0), 0)
      : null,
    maxTotal: weightsComplete
      ? criteria.reduce((sum, c) => sum + (c.weight ?? 0), 0)
      : null,
  };
}
