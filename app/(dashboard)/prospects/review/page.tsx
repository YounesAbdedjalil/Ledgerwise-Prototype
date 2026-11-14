import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import SourceReviewTable, {
  type SourceReviewRow,
} from "@/components/prospects/SourceReviewTable";

const SOURCE_FIELDS =
  "id,company_id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,imported_by,reviewed_by,reviewed_at,verification_note,created_at,companies(name,website)";

export default async function SourceReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const params = await searchParams;
  const companyFilter =
    params.company && isUuid(params.company) ? params.company : null;
  const supabase = await createClient();

  let query = supabase
    .from("company_sources")
    .select(SOURCE_FIELDS)
    .eq("verification_status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(100);

  if (companyFilter) query = query.eq("company_id", companyFilter);

  const [{ data, error }, pendingCount, verifiedCount, rejectedCount] =
    await Promise.all([
      query,
      supabase
        .from("company_sources")
        .select("*", { count: "exact", head: true })
        .eq("verification_status", "pending_review"),
      supabase
        .from("company_sources")
        .select("*", { count: "exact", head: true })
        .eq("verification_status", "verified"),
      supabase
        .from("company_sources")
        .select("*", { count: "exact", head: true })
        .eq("verification_status", "rejected"),
    ]);

  const rows = (data ?? []) as unknown as SourceReviewRow[];
  const filteredCompany = rows[0]?.companies
    ? Array.isArray(rows[0].companies)
      ? rows[0].companies[0]
      : rows[0].companies
    : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/prospects" className="text-sm text-blue-700">
          ← Prospects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Source review</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Imported sources are structurally validated but not human-verified.
          Inspect the source URL, claim, and evidence before marking a source
          verified. Only verified sources can support email personalization.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pending review" value={pendingCount.count ?? 0} tone="text-amber-700" />
        <Stat label="Verified" value={verifiedCount.count ?? 0} tone="text-green-700" />
        <Stat label="Rejected" value={rejectedCount.count ?? 0} tone="text-red-700" />
      </div>

      {companyFilter && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-3 text-sm">
          <span>
            Filtered to{" "}
            <b>{filteredCompany?.name ?? "one company"}</b>
            {filteredCompany?.website
              ? ` (${filteredCompany.website.replace(/^https?:\/\//, "")})`
              : ""}
          </span>
          <Link href="/prospects/review" className="text-blue-700 underline">
            Clear filter
          </Link>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {rows.length === 0 ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-800">No sources are waiting for review.</p>
          <p className="mt-1">
            New imports will appear here. Every imported source starts as
            pending review.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Showing {rows.length} pending source{rows.length === 1 ? "" : "s"}
            {pendingCount.count && pendingCount.count > 100
              ? ` of ${pendingCount.count} total`
              : ""}
            .
          </p>
          <SourceReviewTable rows={rows} showCompany />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}