import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { validateEmailDraft, type DraftSource } from "@/lib/email/draft";
import SourceStatusBadge from "@/components/prospects/SourceStatusBadge";
import EmailStatusBadge from "@/components/emails/StatusBadge";
import DraftEditor from "@/components/emails/DraftEditor";

type Company = {
  id: string;
  name: string;
  website: string;
  contact_name: string;
  contact_role: string;
  contact_email: string | null;
};

type Draft = {
  id: string;
  company_id: string;
  subject: string;
  body: string;
  status: string;
  source_ids: string[];
  revision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  companies: Company | Company[] | null;
};

type EventRow = {
  id: string;
  event_type: string;
  actor_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

function companyOf(draft: Draft): Company | null {
  if (!draft.companies) return null;
  return Array.isArray(draft.companies) ? draft.companies[0] ?? null : draft.companies;
}

function eventLabel(type: string): string {
  switch (type) {
    case "draft_generated":
      return "Draft generated";
    case "draft_edited":
      return "Draft edited";
    case "draft_approved":
      return "Draft approved";
    case "draft_rejected":
      return "Draft rejected";
    case "draft_revision_requested":
      return "Revision requested";
    case "sent_simulated":
      return "Simulated send";
    default:
      return type.replaceAll("_", " ");
  }
}

export default async function EmailDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: draftData } = await supabase
    .from("email_drafts")
    .select(
      "id,company_id,subject,body,status,source_ids,revision_note,reviewed_by,reviewed_at,created_at,updated_at,companies(id,name,website,contact_name,contact_role,contact_email)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!draftData) notFound();
  const draft = draftData as unknown as Draft;
  const company = companyOf(draft);

  const sourceIds = Array.isArray(draft.source_ids) ? draft.source_ids : [];
  const { data: sourceData } =
    sourceIds.length > 0
      ? await supabase
          .from("company_sources")
          .select(
            "id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,reviewed_by,reviewed_at"
          )
          .in("id", sourceIds)
      : { data: [] };

  const { data: eventData } = await supabase
    .from("email_events")
    .select("id,event_type,actor_id,detail,created_at")
    .eq("draft_id", id)
    .order("created_at", { ascending: false });

  const sources = (sourceData ?? []) as DraftSource[];
  const events = (eventData ?? []) as EventRow[];
  const validation = validateEmailDraft({ subject: draft.subject, body: draft.body });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/emails" className="text-sm text-blue-700">
          ← Email review
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{company?.name ?? "Draft"}</h1>
          <EmailStatusBadge status={draft.status} />
        </div>
        {company && (
          <div className="mt-1 text-sm text-gray-600">
            {company.contact_name} ({company.contact_role}) ·{" "}
            {company.contact_email ?? "no email"} ·{" "}
            <Link href={`/prospects/${company.id}`} className="text-blue-700 underline">
              company record
            </Link>
          </div>
        )}
      </div>

      {!validation.ok && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <b>Guardrail check failed.</b>{" "}
          {[...validation.issues, ...validation.guardrails.map((i) => i.message)].join(
            " "
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Draft</h2>
          <div className="rounded border bg-white p-4">
            <DraftEditor
              key={`${draft.updated_at}-${draft.status}`}
              draftId={draft.id}
              status={draft.status}
              subject={draft.subject}
              body={draft.body}
              revisionNote={draft.revision_note}
            />
          </div>
          <p className="text-xs text-gray-500">
            Last updated {draft.updated_at.slice(0, 16).replace("T", " ")}.
            {draft.reviewed_at
              ? ` Reviewed ${draft.reviewed_at.slice(0, 16).replace("T", " ")}.`
              : ""}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Sources used by this draft</h2>
          {sources.length === 0 ? (
            <p className="rounded border bg-white p-4 text-sm text-gray-600">
              No source rows are linked to this draft.
            </p>
          ) : (
            <ul className="space-y-3">
              {sources.map((source) => (
                <li key={source.id} className="rounded border bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {source.claim_type}
                    </span>
                    <SourceStatusBadge status={source.verification_status} />
                  </div>
                  <p className="mt-2 font-medium">{source.claim}</p>
                  <p className="mt-1 text-xs text-gray-700">
                    <span className="text-gray-500">Evidence: </span>
                    {source.evidence}
                  </p>
                  <p className="mt-1 text-xs">
                    <a
                      href={source.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline"
                    >
                      {source.source_title}
                    </a>{" "}
                    <span className="text-gray-500">
                      · retrieved {source.retrieved_at}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            Only sources marked Verified and reviewed by a signed-in user are eligible
            for a new draft. Editing a source back to pending review does not rewrite an
            existing draft, but the source is shown here with its current status.
          </p>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Audit trail</h2>
        {events.length === 0 ? (
          <p className="rounded border bg-white p-4 text-sm text-gray-600">
            No email events recorded yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="rounded border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{eventLabel(event.event_type)}</b>
                  <span className="text-xs text-gray-500">
                    {event.created_at.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                {event.detail.provider ? (
                  <p className="mt-1 text-xs text-gray-600">
                    Provider: {String(event.detail.provider)}
                    {event.detail.model ? ` (${String(event.detail.model)})` : ""}
                    {event.detail.used_fallback ? " · safe template fallback" : ""}
                  </p>
                ) : null}
                {event.detail.note ? (
                  <p className="mt-1 text-xs text-gray-700">{String(event.detail.note)}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}