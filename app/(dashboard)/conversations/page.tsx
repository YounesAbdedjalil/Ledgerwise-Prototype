import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ConversationStatusBadge from "@/components/conversations/StatusBadge";

type ConversationRow = {
  id: string;
  status: string;
  contact_email: string;
  booking_request: boolean;
  created_at: string;
  companies:
    | { name: string }
    | { name: string }[]
    | null;
  messages:
    | {
        body: string;
        created_at: string;
        sender: string;
        needs_review: boolean;
      }[]
    | null;
};

function companyName(row: ConversationRow): string {
  if (!row.companies) return "Unknown company";
  return Array.isArray(row.companies)
    ? row.companies[0]?.name ?? "Unknown company"
    : row.companies.name;
}

function lastMessage(row: ConversationRow) {
  const messages = [...(row.messages ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  return messages[messages.length - 1] ?? null;
}

export default async function ConversationsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id,status,contact_email,booking_request,created_at,companies(name),messages(body,created_at,sender,needs_review)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const conversations = (data ?? []) as unknown as ConversationRow[];
  const needsHuman = conversations.filter(
    (conversation) => conversation.status === "needs_human"
  ).length;
  const bookingRequests = conversations.filter(
    (conversation) => conversation.booking_request
  ).length;
  const drafts = conversations.filter((conversation) =>
    (conversation.messages ?? []).some(
      (message) => message.sender === "ai" && message.needs_review
    )
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Inbound messages are classified by rules before any reply is drafted. Opt-outs
          suppress the contact permanently. Pricing, legal, sensitive, human, and booking
          requests escalate to a person. AI replies are simulated drafts until a human
          approves them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Needs human" value={needsHuman} tone="text-amber-700" />
        <Stat label="AI drafts to review" value={drafts} tone="text-blue-700" />
        <Stat label="Booking requests" value={bookingRequests} tone="text-purple-700" />
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {conversations.length === 0 ? (
        <div className="rounded border bg-white p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-800">No conversations yet.</p>
          <p className="mt-1">
            Approve an email draft and use <b>Simulate send</b> to create a thread.
          </p>
          <Link href="/emails" className="mt-2 inline-block text-blue-700 underline">
            Go to email review
          </Link>
        </div>
      ) : (
        <table className="w-full rounded border bg-white text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">Company</th>
              <th className="p-2">Contact</th>
              <th className="p-2">Last message</th>
              <th className="p-2">Status</th>
              <th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((conversation) => {
              const last = lastMessage(conversation);
              return (
                <tr key={conversation.id} className="border-t align-top">
                  <td className="p-2 font-medium">
                    <Link
                      href={`/conversations/${conversation.id}`}
                      className="text-blue-700 underline"
                    >
                      {companyName(conversation)}
                    </Link>
                  </td>
                  <td className="p-2 text-xs text-gray-600">
                    {conversation.contact_email}
                  </td>
                  <td className="max-w-md p-2 text-xs text-gray-700">
                    {last ? (
                      <>
                        <span className="font-medium">{last.sender}:</span>{" "}
                        {last.body.slice(0, 140)}
                        {last.body.length > 140 ? "…" : ""}
                        {last.sender === "ai" && last.needs_review && (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">
                            draft
                          </span>
                        )}
                      </>
                    ) : (
                      "No messages"
                    )}
                  </td>
                  <td className="p-2">
                    <ConversationStatusBadge status={conversation.status} />
                  </td>
                  <td className="p-2">
                    {conversation.booking_request && (
                      <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800">
                        Booking request
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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