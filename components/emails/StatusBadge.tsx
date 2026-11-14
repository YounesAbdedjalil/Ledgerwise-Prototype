const TONES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  needs_review: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  sent_simulated: "bg-blue-100 text-blue-800 border-blue-200",
  sent: "bg-blue-100 text-blue-800 border-blue-200",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  sent_simulated: "Simulated send",
  sent: "Sent",
};

export default function EmailStatusBadge({ status }: { status: string }) {
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