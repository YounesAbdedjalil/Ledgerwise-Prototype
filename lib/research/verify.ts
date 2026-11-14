import { CLAIM_TYPES, type ClaimType } from "../import-schema";

export type ResearchPage = {
  url: string;
  title: string;
  text: string;
};

export type ProposedClaim = {
  claim_type: string;
  claim: string;
  source_url: string;
  evidence: string;
};

export type VerifiedClaim = {
  claim_type: ClaimType;
  claim: string;
  source_url: string;
  source_title: string;
  evidence: string;
};

export type RejectedClaim = {
  index: number;
  claim_type: string;
  reason: string;
};

export type VerificationResult = {
  accepted: VerifiedClaim[];
  rejected: RejectedClaim[];
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function verifyClaims(
  proposals: ProposedClaim[],
  pages: ResearchPage[],
): VerificationResult {
  const pageByUrl = new Map<string, ResearchPage>();

  for (const page of pages) {
    const key = normalizeUrl(page.url);
    if (key) pageByUrl.set(key, page);
  }

  const accepted: VerifiedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const counts = new Map<ClaimType, number>();
  const seen = new Set<string>();

  proposals.forEach((proposal, index) => {
    const reject = (reason: string) => {
      rejected.push({
        index,
        claim_type: proposal.claim_type ?? "",
        reason,
      });
    };

    const claimType = proposal.claim_type as ClaimType;

    if (!CLAIM_TYPES.includes(claimType)) {
      reject("Unsupported claim type");
      return;
    }

    const claim = (proposal.claim ?? "").trim();
    const evidence = (proposal.evidence ?? "").trim();
    const sourceUrl = normalizeUrl(proposal.source_url ?? "");

    if (!claim || claim.length > 500) {
      reject("Claim is missing or exceeds 500 characters");
      return;
    }

    if (!sourceUrl) {
      reject("Source URL is not a valid HTTP(S) URL");
      return;
    }

    const page = pageByUrl.get(sourceUrl);
    if (!page) {
      reject("Source URL was not among the fetched pages");
      return;
    }

    if (!page.title.trim()) {
      reject("Fetched page has no title");
      return;
    }

    if (evidence.length < 20 || evidence.length > 300) {
      reject("Evidence must be between 20 and 300 characters");
      return;
    }

    const normalizedEvidence = normalizeText(evidence);
    const normalizedPage = normalizeText(page.text);

    if (!normalizedPage.includes(normalizedEvidence)) {
      reject("Evidence quote does not appear in the fetched page text");
      return;
    }

    if (claimType === "contact") {
      const parts = claim.split("|").map((part) => part.trim());
      const [name, role, email] = parts;

      if (!name || !role || parts.length > 3) {
        reject('Contact must use "Name | Role" or "Name | Role | email"');
        return;
      }

      if (
        !normalizedEvidence.includes(normalizeText(name)) ||
        !normalizedEvidence.includes(normalizeText(role))
      ) {
        reject("Contact name and role must both appear in the evidence quote");
        return;
      }

      if (email) {
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          reject("Contact email is not a valid email address");
          return;
        }

        if (!normalizedPage.includes(normalizeText(email))) {
          reject("Contact email does not appear in the fetched page");
          return;
        }
      }
    }

    const duplicateKey = `${claimType}:${normalizeText(claim)}`;
    if (seen.has(duplicateKey)) {
      reject("Duplicate claim");
      return;
    }

    const count = counts.get(claimType) ?? 0;
    if (count >= 3) {
      reject("Maximum of three accepted claims per claim type reached");
      return;
    }

    seen.add(duplicateKey);
    counts.set(claimType, count + 1);

    accepted.push({
      claim_type: claimType,
      claim,
      source_url: page.url,
      source_title: page.title.trim(),
      evidence,
    });
  });

  return { accepted, rejected };
}
