import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { selectEmailSources, type DraftSource } from "@/lib/email/draft";
import SourceStatusBadge from "@/components/prospects/SourceStatusBadge";
import ConversationStatusBadge from "@/components/conversations/StatusBadge";
import ConversationActions from "@/components/conversations/ConversationActions";
import MessageActions from "@/components/conversations/MessageActions";

type Conversation = {
  id: string;
  company_id: string;
  contact_email: string;
  status: string;
  booking_request: boolean;
  assigned_to: string | null;
  created_at: string;
  companies:
    | { id: string; name: string; website: string; contact_name: string }
    | { id: string; name: string; website: string; contact_name: string }[]
    | null;
};

type Message = {
  id: string;
  sender: string;
  body: string;
  classification: string | null;
  needs_review: boolean;
  guardrail_flags: string[] | null;
  is_simulated: boolean;
  created_at: string;
};

function companyOf(conversation: Conversation) {
  if (!conversation.companies) return null;
  return Array.isArray(conversation.companies)
    ? conversation.companies[0] ?? null
    : conversation.companies;
}

function senderLabel(sender: string): string {
  switch (sender) {
    case "prospect":
      return "Prospect";
    case "ai":
      return "AI assistant";
    case "human":
      return "Salesperson";
    default:
      return sender;
  }
}

function senderTone(sender: string): string {
  switch (sender) {
    case "prospect":
      return "bg-gray-50 border-gray-200";
    case "ai":
      return "bg-blue-50 border-blue-200";
    case "human":
      return "bg-purple-50 border-purple-200";
    default:
      return "bg-white border-gray-200";
  }
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: conversationData } = await supabase
    .from("conversations")
    .select(
      "id,company_id,contact_email,status,booking_request,assigned_to,created_at,companies(id,name,website,contact_name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!conversationData) notFound();

  const conversation = conversationData as unknown as Conversation;
  const company = companyOf(conversation);

  const [{ data: messageData }, { data: sourceData }] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id,sender,body,classification,needs_review,guardrail_flags,is_simulated,created_at"
      )
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("company_sources")
      .select(
        "id,claim,claim_type,source_url,source_title,retrieved_at,evidence,verification_status,reviewed_by,reviewed_at"
      )
      .eq("company_id", conversation.company_id),
  ]);

  const messages = (messageData ?? []) as Message[];
  const verifiedSources = selectEmailSources((sourceData ?? []) as DraftSource[]);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href="/conversations" className="text-sm text-blue-700">
          ← Conversations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {company?.name ?? "Conversation"}
          </h1>
          <ConversationStatusBadge status={conversation.status} />
          {conversation.booking_request && (
            <span className="rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
              Booking request
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {conversation.contact_email}
          {company && (
            <>
              {" "}·{" "}
              <Link
                href={`/prospects/${company.id}`}
                className="text-blue-700 underline"
              >
                company record
              </Link>
            </>
          )}
        </p>
        <p className="mt-2 max-w-3xl text-xs text-gray-500">
          All sends in this prototype are simulated. Inbound messages are added manually
          to exercise the rules. AI replies are drafts and are not counted as sent until a
          human approves them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Thread</h2>
          {messages.length === 0 ? (
            <p className="rounded border bg-white p-4 text-sm text-gray-600">
              No messages yet. Add a simulated prospect reply to start.
            </p>
          ) : (
            <ol className="space-y-3">
              {messages.map((message) => {
                const discarded =
                  message.sender === "ai" &&
                  (message.guardrail_flags ?? []).includes("discarded");
                return (
                  <li
                    key={message.id}
                    className={`rounded border p-4 text-sm ${senderTone(message.sender)}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{senderLabel(message.sender)}</b>
                        {message.classification && (
                          <span className="rounded bg-white px-2 py-0.5 text-xs text-gray-600">
                            {message.classification.replaceAll("_", " ")}
                          </span>
                        )}
                        {message.sender === "ai" && message.needs_review && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            AI draft — not sent
                          </span>
                        )}
                        {discarded && (
                          <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                            discarded
                          </span>
                        )}
                        {message.is_simulated && (
                          <span className="text-xs text-gray-500">simulated</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        {message.created_at.slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap leading-6">{message.body}</p>
                    {message.guardrail_flags && message.guardrail_flags.length > 0 && (
                      <p className="mt-2 text-xs text-gray-600">
                        Flags: {message.guardrail_flags.join(", ")}
                      </p>
                    )}
                    {message.sender === "ai" && message.needs_review && !discarded && (
                      <MessageActions messageId={message.id} />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Actions</h2>
            <div className="rounded border bg-white p-3">
              <ConversationActions
                conversationId={conversation.id}
                companyId={conversation.company_id}
                status={conversation.status}
                bookingRequest={conversation.booking_request}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Verified facts available</h2>
            {verifiedSources.length === 0 ? (
              <p className="rounded border bg-white p-3 text-sm text-gray-600">
                No verified sources. AI replies use a safe generic fallback until sources
                are reviewed.
              </p>
            ) : (
              <ul className="space-y-2">
                {verifiedSources.map((source) => (
                  <li key={source.id} className="rounded border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {source.claim_type}
                      </span>
                      <SourceStatusBadge status={source.verification_status} />
                    </div>
                    <p className="mt-1 font-medium">{source.claim}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Evidence: {source.evidence}
                    </p>
                    <a
                      href={source.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-700 underline"
                    >
                      {source.source_title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}