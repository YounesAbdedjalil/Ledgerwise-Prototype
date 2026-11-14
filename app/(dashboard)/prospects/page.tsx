import Link from "next/link";
import DiscoverCompaniesButton from "@/components/DiscoverCompaniesButton";
import { createClient } from "@/lib/supabase/server";
import ScoreGenerationButton from "./ScoreGenerationButton";

type Row = {
  id: string;
  name: string;
  website: string;
  category: string;
  qualification_status: string;
  company_sources: { count: number }[];
};

type ScoreRow = {
  company_id: string;
  criterion: string;
  weight: number;
  points: number;
  reason: string;
  created_at: string;
};

type LatestScore = {
  total: number;
  criterionCount: number;
  provisional: boolean;
};

export default async function ProspectsPage() {
  const supabase = await createClient();

  const [
    { data, error },
    pendingReview,
    { data: scoreRows, error: scoreError },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id,name,website,category,qualification_status,company_sources(count)")
      .order("name"),
    supabase
      .from("company_sources")
      .select("*", { count: "exact", head: true })
      .eq("verification_status", "pending_review"),
    supabase
      .from("qualification_scores")
      .select("company_id,criterion,weight,points,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(25000),
  ]);

  const companies = (data ?? []) as Row[];
  const pendingCount = pendingReview.count ?? 0;
  const latestScores = new Map<string, LatestScore>();
  const rows = (scoreRows ?? []) as ScoreRow[];

  // Rows are newest first. Keep only the newest batch for each company.
  for (const row of rows) {
    const current = latestScores.get(row.company_id);
    if (!current) {
      latestScores.set(row.company_id, {
        total: row.points,
        criterionCount: 1,
        provisional: row.reason.includes("remains unknown"),
      });
      continue;
    }

    const latestTimestamp = rows.find(
      (candidate) => candidate.company_id === row.company_id
    )?.created_at;

    if (row.created_at === latestTimestamp) {
      current.total += row.points;
      current.criterionCount += 1;
      current.provisional ||= row.reason.includes("remains unknown");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Prospects ({companies.length})
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <DiscoverCompaniesButton />
          <Link
            href="/prospects/review"
            className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            Review sources ({pendingCount})
          </Link>
          <Link
            href="/prospects/import"
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
          >
            Import CSV
          </Link>
          <ScoreGenerationButton />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error.message}</p>}
      {scoreError && (
        <p className="text-red-600 text-sm">
          Could not load saved qualification scores: {scoreError.message}
        </p>
      )}

      {companies.length === 0 ? (
        <p className="text-gray-500">
          No companies yet. Import your research CSV to begin.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="p-3">Company</th>
                <th className="p-3">Website</th>
                <th className="p-3">Category</th>
                <th className="p-3">Sources</th>
                <th className="p-3">Score</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const score = latestScores.get(company.id);
                const hasCompleteBatch =
                  score?.criterionCount === 5;

                return (
                  <tr key={company.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">
                      <Link
                        href={`/prospects/${company.id}`}
                        className="text-blue-700 underline"
                      >
                        {company.name}
                      </Link>
                    </td>
                    <td className="p-3">
                      {company.website.replace("https://", "")}
                    </td>
                    <td className="p-3">{company.category}</td>
                    <td className="p-3">
                      {company.company_sources[0]?.count ?? 0}
                    </td>
                    <td className="p-3">
                      {score && hasCompleteBatch ? (
                        <span className="font-semibold text-slate-800">
                          {score.total}/100
                          {score.provisional && (
                            <span className="ml-2 text-xs font-medium text-amber-700">
                              Provisional
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not scored</span>
                      )}
                    </td>
                    <td className="p-3">{company.qualification_status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
