"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { getScoringConfig } from "@/lib/scoring/custom";
import { scoreCompany, type SourceRow } from "@/lib/scoring/score";

export type GenerateScoresResult = {
  ok: boolean;
  companiesScored?: number;
  scoreRowsCreated?: number;
  warning?: string;
  error?: string;
};

type CompanyRow = { id: string; name: string };

export async function generateQualificationScores(): Promise<GenerateScoresResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };

  const scoringConfig = getScoringConfig();
  const criteria = scoringConfig.criteria;
  const totalWeight = criteria.reduce(
    (sum, criterion) => sum + (criterion.weight ?? 0),
    0
  );
  if (
    criteria.some(
      (criterion) =>
        criterion.weight === null ||
        !Number.isInteger(criterion.weight) ||
        criterion.weight <= 0
    ) ||
    totalWeight !== 100
  ) {
    return {
      ok: false,
      error: "Scoring configuration is invalid. Criteria weights must total 100.",
    };
  }

  const [
    { data: companies, error: companyError },
    { data: sources, error: sourceError },
  ] = await Promise.all([
    supabase.from("companies").select("id,name").order("name").limit(5000),
    supabase
      .from("company_sources")
      .select(
        "id,company_id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,reviewed_by,reviewed_at"
      )
      .limit(10000),
  ]);

  if (companyError) return { ok: false, error: companyError.message };
  if (sourceError) return { ok: false, error: sourceError.message };

  const companyRows = (companies ?? []) as CompanyRow[];
  if (companyRows.length === 0) {
    return { ok: false, error: "There are no companies to score." };
  }

  const sourcesByCompany = new Map<string, SourceRow[]>();
  for (const source of (sources ?? []) as (SourceRow & {
    company_id: string;
  })[]) {
    const current = sourcesByCompany.get(source.company_id) ?? [];
    current.push(source);
    sourcesByCompany.set(source.company_id, current);
  }

  const batchTimestamp = new Date().toISOString();
  const scoreRows = companyRows.flatMap((company) => {
    const score = scoreCompany(sourcesByCompany.get(company.id) ?? [], criteria);
    return score.criteria.map((result) => ({
      company_id: company.id,
      criterion: result.criterion.key,
      weight: result.criterion.weight!,
      points: result.points ?? 0,
      reason: result.reason,
      source_id:
        result.points && result.sources.length > 0
          ? result.sources[0].id
          : null,
      created_at: batchTimestamp,
    }));
  });

  const { error: insertError } = await supabase
    .from("qualification_scores")
    .insert(scoreRows);

  if (insertError) return { ok: false, error: insertError.message };

  const audit = await writeAudit(supabase, {
    actorId: user.id,
    action: "qualification_scores_generated",
    entityType: "qualification_scores",
    detail: {
      companies_scored: companyRows.length,
      score_rows_created: scoreRows.length,
      scoring_batch: batchTimestamp,
      weights: Object.fromEntries(
        criteria.map((criterion) => [criterion.key, criterion.weight])
      ),
      evidence_rule: "Only human-verified sources earn positive points.",
      scoring_config_source: scoringConfig.source,
    },
  });

  revalidatePath("/prospects");
  for (const company of companyRows) {
    revalidatePath(`/prospects/${company.id}`);
  }

  return {
    ok: true,
    companiesScored: companyRows.length,
    scoreRowsCreated: scoreRows.length,
    warning: [
      scoringConfig.warning,
      audit.ok ? undefined : `Scores were saved, but the audit entry failed: ${audit.error}`,
    ].filter(Boolean).join(" ") || undefined,
  };
}
