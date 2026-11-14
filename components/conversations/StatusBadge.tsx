const TONES: Record<string, string> = {
  ai_handling: "bg-blue-100 text-blue-800 border-blue-200",
  needs_human: "bg-amber-100 text-amber-800 border-amber-200",
  human_takeover: "bg-purple-100 text-purple-800 border-purple-200",
  closed: "bg-gray-100 text-gray-700 border-gray-200",
  suppressed: "bg-red-100 text-red-800 border-red-200",
};

const LABELS: Record<string, string> = {
  ai_handling: "AI handling",
  needs_human: "Needs human",
  human_takeover: "Human takeover",
  closed: "Closed",
  suppressed: "Suppressed",
};

export default function ConversationStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        TONES[status] ?? "bg-gray-100 text-gray-700 border-gray-200"
      }`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}