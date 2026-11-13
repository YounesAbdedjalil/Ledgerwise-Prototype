import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { scoreCompany, type SourceRow } from "@/lib/scoring/score";
import ScoreBreakdown, { SourceItem } from "@/components/ScoreBreakdown";

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!company) notFound();

  const { data } = await supabase
    .from("company_sources")
    .select("id,claim,claim_type,source_url,source_title,retrieved_at,evidence")
    .eq("company_id", id)
    .order("retrieved_at", { ascending: false });

  const sources = (data ?? []) as SourceRow[];
  const score = scoreCompany(sources);
  const categorySources = sources.filter((s) => s.claim_type === "category");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/prospects" className="text-sm text-blue-700">
          ← Prospects
        </Link>
        <h1 className="text-2xl font-semibold mt-2">{company.name}</h1>
        <a
          href={company.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-700 underline"
        >
          {company.website}
        </a>
      </div>

      <div className="bg-white border rounded p-4 text-sm grid grid-cols-2 gap-2">
        <div>
          <span className="text-gray-500">Category: </span>
          {company.category}
        </div>
        <div>
          <span className="text-gray-500">US e-commerce: </span>
          {company.us_ecommerce}
        </div>
        <div>
          <span className="text-gray-500">Contact: </span>
          {company.contact_name} ({company.contact_role})
        </div>
        <div>
          <span className="text-gray-500">Email: </span>
          {company.contact_email ?? "unknown"}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Score breakdown</h2>
        <ScoreBreakdown score={score} />
      </section>

      {categorySources.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Category sources</h2>
          <ul className="bg-white border rounded p-4 space-y-2">
            {categorySources.map((s) => (
              <li key={s.id} className="text-sm">
                {s.claim}
                <ul>
                  <SourceItem s={s} />
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
