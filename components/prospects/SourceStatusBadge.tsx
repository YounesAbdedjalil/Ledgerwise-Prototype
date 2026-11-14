import {
  sourceStatusLabel,
  sourceStatusTone,
} from "@/lib/sources/verification";

export default function SourceStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${sourceStatusTone(status)}`}
    >
      {sourceStatusLabel(status)}
    </span>
  );
}