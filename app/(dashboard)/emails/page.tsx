import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/validation";
import {
  isUsableVerifiedContact,
  type SourceLike,
} from "@/lib/sources/verification";
import EmailStatusBadge from "@/components/emails/StatusBadge";
import GenerateDraftButton from "@/components/emails/GenerateDraftButton";

type DraftRow = {
  id: string;
  subject: string;
  status: string;
  updated_at: string;
  companies:
    | { name: string; contact_email: string | null }
    | { name: string; contact_email: string | null }[]
    | null;
};

type CompanyRow = {
  id: string;
  name: string;
  contact_email: string | null;
  qualification_status: string;
};

type ContactSourceRow = SourceLike & { company_id: string };

function companyOf(row: DraftRow) {
  if (!row.companies) return null;
  return Array.isArray(row.companies) ? row.companies[0] ?? null : row.companies;
}

export default async function EmailsPage() {
  const supabase = await createClient();
  const [
    { data: draftData, error: draftError },
    { data: companyData },
    { data: contactSourceData },
  ] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("id,subject,status,updated_at,companies(name,contact_email)")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("companies")
      .select("id,name,contact_email,qualification_status")
      .not("contact_email", "is", null)
      .order("name")
      .limit(100),
    supabase
      .from("company_sources")
      .select(
        "company_id,claim,claim_type,source_url,evidence,verification_status,reviewed_by,reviewed_at"
      )
      .eq("claim_type", "contact")
      .eq("verification_status", "verified")
      .limit(1_000),
  ]);

  const drafts = (draftData ?? []) as unknown as DraftRow[];
  const contactSources = (contactSourceData ?? []) as ContactSourceRow[];
  const companies = ((companyData ?? []) as CompanyRow[]).filter((company) => {
    const email = company.contact_email ? normalizeEmail(company.contact_email) : "";
    return contactSources.some(
      (source) =>
        source.company_id === company.id && isUsableVerifiedContact(source, email)
    );
  });

  const counts = {
    needs_review: drafts.filter((d) => d.status === "needs_review").length,
    approved: drafts.filter((d) => d.status === "approved").length,
    rejected: drafts.filter((d) => d.status === "rejected").length,
    sent: drafts.filter(
      (d) => d.status === "sent_simulated" || d.status === "sent"
    ).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Email review</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Drafts use only human-verified sources. Approving records the decision;
          sending is always labeled <b>Simulated send: demo path</b>. No real email
          leaves this prototype.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Needs review" value={counts.needs_review} tone="text-amber-700" />
        <Stat label="Approved" value={counts.approved} tone="text-green-700" />
        <Stat label="Rejected" value={counts.rejected} tone="text-red-700" />
        <Stat label="Simulated sends" value={counts.sent} tone="text-blue-700" />
      </div>

      {draftError && <p className="text-sm text-red-600">{draftError.message}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Draft queue</h2>
        {drafts.length === 0 ? (
          <p className="rounded border bg-white p-4 text-sm text-gray-600">
            No drafts yet. Pick a company with a public contact email below.
          </p>
        ) : (
          <table className="w-full rounded border bg-white text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Company</th>
                <th className="p-2">Subject</th>
                <th className="p-2">Status</th>
                <th className="p-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const company = companyOf(draft);
                return (
                  <tr key={draft.id} className="border-t">
                    <td className="p-2 font-medium">{company?.name ?? "Unknown"}</td>
                    <td className="p-2">
                      <Link
                        href={`/emails/${draft.id}`}
                        className="text-blue-700 underline"
                      >
                        {draft.subject}
                      </Link>
                    </td>
                    <td className="p-2">
                      <EmailStatusBadge status={draft.status} />
                    </td>
                    <td className="p-2 text-xs text-gray-500">
                      {draft.updated_at.slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Start a draft</h2>
        <p className="text-sm text-gray-600">
          These companies have a human-verified contact source that contains the
          recipient email. Other companies stay hidden until their contact source is
          verified in the review queue.
        </p>
        {companies.length === 0 ? (
          <p className="rounded border bg-white p-4 text-sm text-gray-600">
            No company has a verified contact source yet. Verify one in the{" "}
            <Link href="/prospects/review" className="text-blue-700 underline">
              source review queue
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y rounded border bg-white">
            {companies.map((company) => (
              <li
                key={company.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div>
                  <Link
                    href={`/prospects/${company.id}`}
                    className="font-medium text-blue-700 underline"
                  >
                    {company.name}
                  </Link>
                  <div className="text-xs text-gray-500">
                    {company.contact_email} · {company.qualification_status}
                  </div>
                </div>
                <GenerateDraftButton
                  companyId={company.id}
                  companyName={company.name}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
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