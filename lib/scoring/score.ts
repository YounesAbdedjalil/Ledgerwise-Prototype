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
  points: number | null;
  reason: string;
  sources: SourceRow[];
};

export type ScoreResult = {
  criteria: CriterionResult[];
  disqualifiers: SourceRow[];
  weightsComplete: boolean;
  total: number | null;
  maxTotal: number | null;
  provisional: boolean;
};

function isHumanVerified(source: SourceRow): boolean {
  return (
    source.verification_status === "verified" &&
    Boolean(source.reviewed_by) &&
    Boolean(source.reviewed_at)
  );
}

export function scoreCompany(
  sources: SourceRow[],
  criteria: Criterion[] = CRITERIA
): ScoreResult {
  const weightsComplete = criteria.every(
    (criterion) =>
      criterion.weight !== null &&
      Number.isInteger(criterion.weight) &&
      criterion.weight > 0
  );

  const verifiedSources = sources.filter(isHumanVerified);

  const results: CriterionResult[] = criteria.map((criterion) => {
    const matched = verifiedSources.filter(
      (source) => source.claim_type === criterion.claimType
    );
    const met = matched.length > 0;
    const points =
      criterion.weight === null ? null : met ? criterion.weight : 0;

    const hasUnverifiedEvidence = sources.some(
      (source) => source.claim_type === criterion.claimType
    );

    const reason = met
      ? matched.map((source) => source.claim).join("; ")
      : hasUnverifiedEvidence
        ? "Evidence exists but has not been human-verified; this criterion remains unknown."
        : "No human-verified evidence recorded; this criterion remains unknown.";

    return {
      criterion,
      met,
      points,
      reason,
      sources: matched,
    };
  });

  const disqualifiers = verifiedSources.filter(
    (source) => source.claim_type === "disqualifier"
  );

  const provisional = results.some((result) => !result.met);

  return {
    criteria: results,
    disqualifiers,
    weightsComplete,
    total: weightsComplete
      ? results.reduce((sum, result) => sum + (result.points ?? 0), 0)
      : null,
    maxTotal: weightsComplete
      ? criteria.reduce((sum, criterion) => sum + (criterion.weight ?? 0), 0)
      : null,
    provisional,
  };
}
