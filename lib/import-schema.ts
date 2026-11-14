export const CLAIM_TYPES = [
  "us_ecommerce",
  "category",
  "size_fit",
  "growth_signal",
  "pain_signal",
  "disqualifier",
  "contact",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const REQUIRED_COLUMNS = [
  "company_name",
  "website",
  "claim_type",
  "claim",
  "source_url",
  "source_title",
  "retrieved_at",
  "evidence",
] as const;

export type RawRow = Record<string, string>;

export type ValidRow = {
  company_name: string;
  host: string; // normalized hostname, used to deduplicate companies
  claim_type: ClaimType;
  claim: string;
  source_url: string;
  source_title: string;
  retrieved_at: string; // YYYY-MM-DD
  evidence: string;
};

export type RowResult =
  | { ok: true; row: ValidRow }
  | { ok: false; errors: string[] };

export function hostFromUrl(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!u.hostname.includes(".")) return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function validateRow(raw: RawRow): RowResult {
  const errors: string[] = [];
  const get = (k: string) => (raw[k] ?? "").trim();

  const company_name = get("company_name");
  if (!company_name) errors.push("company_name is missing");

  const host = hostFromUrl(get("website"));
  if (!host) errors.push("website is missing or not a valid URL");

  const claim_type = get("claim_type") as ClaimType;
  if (!CLAIM_TYPES.includes(claim_type))
    errors.push(`claim_type must be one of: ${CLAIM_TYPES.join(", ")}`);

  const claim = get("claim");
  if (!claim) errors.push("claim is missing");

  const source_url = get("source_url");
  if (!/^https?:\/\/\S+\.\S+/i.test(source_url))
    errors.push("source_url must be a full http(s) URL");

  const source_title = get("source_title");
  if (!source_title) errors.push("source_title is missing");

  const retrieved_at = get("retrieved_at");
  const today = new Date().toISOString().slice(0, 10);
  const retrievedDate = new Date(`${retrieved_at}T00:00:00Z`);
  const realDate =
    /^\d{4}-\d{2}-\d{2}$/.test(retrieved_at) &&
    !isNaN(retrievedDate.getTime()) &&
    retrievedDate.toISOString().slice(0, 10) === retrieved_at;
  if (!realDate) {
    errors.push("retrieved_at must be a real date as YYYY-MM-DD");
  } else if (retrieved_at > today) {
    errors.push("retrieved_at cannot be in the future");
  }

  const evidence = get("evidence");
  if (evidence.length < 10)
    errors.push("evidence must be a quote or summary of at least 10 characters");

  if (claim_type === "contact") {
    const parts = claim.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1])
      errors.push('contact claim must look like "Name | Role" or "Name | Role | email"');
    if (parts[2] && !/^\S+@\S+\.\S+$/.test(parts[2]))
      errors.push("contact email in claim is not a valid email");
  }

  if (errors.length > 0 || !host) return { ok: false, errors };
  return {
    ok: true,
    row: { company_name, host, claim_type, claim, source_url, source_title, retrieved_at, evidence },
  };
}
