import { isHttpUrl } from "../validation";

export const SOURCE_VERIFICATION_STATUSES = [
  "pending_review",
  "verified",
  "rejected",
] as const;

export type SourceVerificationStatus =
  (typeof SOURCE_VERIFICATION_STATUSES)[number];

export type VerificationFields = {
  imported_by: string | null;
  verification_status: SourceVerificationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  verification_note: string | null;
  verified_by: string | null;
};

export type ReviewPatch = Omit<VerificationFields, "imported_by">;

export type SourceLike = {
  claim: string;
  claim_type: string;
  source_url: string;
  evidence: string;
  verification_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export const EMAIL_CLAIM_TYPES = new Set([
  "us_ecommerce",
  "category",
  "size_fit",
  "growth_signal",
  "pain_signal",
]);

export function isSourceVerificationStatus(
  value: unknown
): value is SourceVerificationStatus {
  return (
    typeof value === "string" &&
    (SOURCE_VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

export function newImportFields(userId: string): VerificationFields {
  return {
    imported_by: userId,
    verification_status: "pending_review",
    reviewed_by: null,
    reviewed_at: null,
    verification_note: null,
    verified_by: null,
  };
}

export function verifyFields(userId: string, nowIso: string): ReviewPatch {
  return {
    verification_status: "verified",
    reviewed_by: userId,
    reviewed_at: nowIso,
    verification_note: null,
    verified_by: null,
  };
}

export function rejectFields(
  userId: string,
  nowIso: string,
  note: string
): ReviewPatch {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("A rejection note is required.");
  return {
    verification_status: "rejected",
    reviewed_by: userId,
    reviewed_at: nowIso,
    verification_note: trimmed,
    verified_by: null,
  };
}

export function resetFields(): ReviewPatch {
  return {
    verification_status: "pending_review",
    reviewed_by: null,
    reviewed_at: null,
    verification_note: null,
    verified_by: null,
  };
}

export function canVerify(status: string): boolean {
  return isSourceVerificationStatus(status);
}

export function canReject(status: string): boolean {
  return isSourceVerificationStatus(status);
}

export function canReset(status: string): boolean {
  return status === "verified" || status === "rejected";
}

export function isStructurallyValidSource(
  source: Pick<SourceLike, "claim" | "source_url" | "evidence">
): boolean {
  if (!source.claim.trim() || !source.evidence.trim()) return false;
  if (source.evidence.trim().length < 10) return false;
  if (source.source_url.trim().toUpperCase() === "UNVERIFIED") return false;
  return isHttpUrl(source.source_url);
}

export function isUsableVerifiedSource(source: SourceLike): boolean {
  return (
    source.verification_status === "verified" &&
    source.reviewed_by !== null &&
    source.reviewed_at !== null &&
    EMAIL_CLAIM_TYPES.has(source.claim_type) &&
    isStructurallyValidSource(source)
  );
}

// A recipient address is only trusted when a human verified the public contact
// source that contains it.
export function isUsableVerifiedContact(
  source: SourceLike,
  email: string
): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const addresses =
    source.claim.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return (
    source.claim_type === "contact" &&
    source.verification_status === "verified" &&
    source.reviewed_by !== null &&
    source.reviewed_at !== null &&
    isStructurallyValidSource(source) &&
    addresses.some((address) => address.toLowerCase() === normalized)
  );
}

export function sourceStatusLabel(status: string): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected";
    case "pending_review":
      return "Pending review";
    default:
      return "Unknown status";
  }
}

export function sourceStatusTone(status: string): string {
  switch (status) {
    case "verified":
      return "bg-green-100 text-green-800 border-green-200";
    case "rejected":
      return "bg-red-100 text-red-800 border-red-200";
    case "pending_review":
      return "bg-amber-100 text-amber-800 border-amber-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}