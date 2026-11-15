import { discoverSameSiteLinks, fetchResearchPage, validateResearchUrl } from "./pages";
import { extractClaims } from "./extract";
import { verifyClaims, type ProposedClaim, type ResearchPage } from "./verify";
import { assessEcommerceEligibility } from "./eligibility";
import { AiUnavailableError } from "../ai";
import {
  pagesHaveUsEvidence,
  rankPagesByUsEvidence,
  selectEnrichmentPages,
  usEvidenceExcerpt,
} from "./usSignals";

export type ResearchInputEntry = {
  companyName: string;
  website: string;
  extraUrls: string[];
};

export type ResearchOutputRow = {
  company_name: string;
  website: string;
  claim_type: string;
  claim: string;
  source_url: string;
  source_title: string;
  retrieved_at: string;
  evidence: string;
};

export type ResearchOutcome = "qualified" | "rejected" | "failed";

/**
 * Where a candidate left the funnel. "rejected" stages are judgements about the
 * company (safe to remember); "failed" stages are infrastructure problems
 * (fetch, AI) and must be retried later rather than remembered.
 */
export type ResearchStage =
  | "fetch"
  | "early_service"
  | "eligibility"
  | "no_us_signal"
  | "us_evidence"
  | "extraction"
  | "ai_unavailable"
  | "no_claims"
  | "complete";

export type CompanyResearchReport = {
  companyName: string;
  website: string;
  outcome?: ResearchOutcome;
  stage?: ResearchStage;
  pagesRead: string[];
  proposed: number;
  accepted: number;
  rejected: number;
  errors: string[];
  rejectedClaims: {
    claim_type: string;
    reason: string;
  }[];
};

export type ResearchRunResult = {
  rows: ResearchOutputRow[];
  companies: CompanyResearchReport[];
  /** Entries never started because deps.shouldStop() returned true. */
  notStarted?: ResearchInputEntry[];
};

type RunnerDeps = {
  fetchPage?: (url: string) => Promise<ResearchPage>;
  extract?: (
    companyName: string,
    pages: ResearchPage[],
  ) => Promise<ProposedClaim[]>;
  discoverLinks?: (text: string, baseUrl: string, maxLinks?: number) => string[];
  now?: () => Date;
  concurrency?: number;
  requireEcommerceEligibility?: boolean;
  /** Checked before each company starts; lets a caller enforce a time budget. */
  shouldStop?: () => boolean;
  /** Page cap per company (default 8). */
  maxPagesPerCompany?: number;
};

// Autonomous discovery spends LLM calls gate-first: at most GATE_PAGE_LIMIT
// calls to find verified US evidence, and only candidates that pass get up to
// ENRICHMENT_PAGE_LIMIT further calls for contacts/growth/size claims.
const GATE_PAGE_LIMIT = 2;
const ENRICHMENT_PAGE_LIMIT = 2;

function validateHttpUrl(value: string, lineNumber: number): URL {
  try {
    return validateResearchUrl(value);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid URL";

    throw new Error(`Line ${lineNumber}: ${message}`);
  }
}

export function parseResearchInput(input: string): ResearchInputEntry[] {
  const entries: ResearchInputEntry[] = [];
  const errors: string[] = [];

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) return;

    const fields = line.split("|").map((field) => field.trim());
    const [companyName, rawWebsite, ...rawExtraUrls] = fields;

    if (!companyName || !rawWebsite) {
      errors.push(`Line ${lineNumber}: expected Company | Website | optional extra URLs`);
      return;
    }

    try {
      const website = validateHttpUrl(rawWebsite, lineNumber);
      const extraUrls = rawExtraUrls
        .filter(Boolean)
        .map((value) => validateHttpUrl(value, lineNumber));

      for (const extraUrl of extraUrls) {
        if (extraUrl.hostname !== website.hostname) {
          throw new Error(
            `Line ${lineNumber}: extra page must belong to the same website as the homepage`,
          );
        }
      }

      entries.push({
        companyName,
        website: website.toString(),
        extraUrls: [...new Set(extraUrls.map((url) => url.toString()))],
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : `Line ${lineNumber}: invalid entry`,
      );
    }
  });

  if (errors.length) {
    throw new Error(`Research input contains errors:\n${errors.join("\n")}`);
  }

  if (!entries.length) {
    throw new Error("Research input contains no companies");
  }

  return entries;
}

export async function runResearch(
  entries: ResearchInputEntry[],
  deps: RunnerDeps = {},
): Promise<ResearchRunResult> {
  const fetchPage = deps.fetchPage ?? fetchResearchPage;
  const extract = deps.extract ?? extractClaims;
  const discoverLinks = deps.discoverLinks ?? discoverSameSiteLinks;
  const now = deps.now ?? (() => new Date());

  const requestedConcurrency = Number.isFinite(deps.concurrency)
    ? Math.floor(deps.concurrency!)
    : 4;
  const concurrency = Math.max(1, Math.min(8, requestedConcurrency));

  const researchCompany = async (
    entry: ResearchInputEntry,
  ): Promise<{ rows: ResearchOutputRow[]; report: CompanyResearchReport }> => {
    const report: CompanyResearchReport = {
      companyName: entry.companyName,
      website: entry.website,
      pagesRead: [],
      proposed: 0,
      accepted: 0,
      rejected: 0,
      errors: [],
      rejectedClaims: [],
    };

    const pages: ResearchPage[] = [];
    const visited = new Set<string>();

    const readPage = async (url: string) => {
      let safeUrl: URL;

      try {
        safeUrl = validateResearchUrl(url);

        const homepageHost = validateResearchUrl(entry.website).hostname;
        if (safeUrl.hostname !== homepageHost) {
          throw new Error("Page must belong to the same website as the homepage");
        }
      } catch (error) {
        report.errors.push(
          `Could not read ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      const normalizedUrl = safeUrl.toString();
      if (visited.has(normalizedUrl)) return;
      visited.add(normalizedUrl);

      try {
        const page = await fetchPage(normalizedUrl);
        pages.push(page);
        report.pagesRead.push(page.url);
      } catch (error) {
        report.errors.push(
          `Could not read ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    // Start with the homepage, then prioritize useful internal pages. A second
    // discovery pass from those pages catches deeper About/Team/Press links.
    // The hard cap keeps free-tier search/AI usage predictable per company.
    const MAX_PAGES_PER_COMPANY = Math.max(
      1,
      Math.min(8, Math.floor(deps.maxPagesPerCompany ?? 8)),
    );
    await readPage(entry.website);

    // Cheap early exit: a homepage with no storefront signal at all and several
    // service-business signals (bookkeeping, CFO, consulting...) is not worth
    // another five page fetches.
    if (deps.requireEcommerceEligibility && pages.length) {
      const early = assessEcommerceEligibility([pages[0]]);
      if (early.commerceSignals.length === 0 && early.serviceSignals.length >= 2) {
        report.errors.push(
          `Autonomous discovery rejected this candidate: the homepage shows no storefront signals and several service-business signals (${early.serviceSignals.join(", ")}).`
        );
        report.outcome = "rejected";
        report.stage = "early_service";
        return { rows: [], report };
      }
    }

    const homepageLinks = pages.length
      ? discoverLinks(pages[0].text, entry.website, 6)
      : [];
    const firstWave = [...new Set([...entry.extraUrls, ...homepageLinks])]
      .slice(0, MAX_PAGES_PER_COMPANY - pages.length);
    await Promise.all(firstWave.map(readPage));

    const secondWave = pages
      .slice(1)
      .flatMap((page) => discoverLinks(page.text, page.url, 3))
      .filter((url) => !visited.has(url));
    const remaining = Math.max(0, MAX_PAGES_PER_COMPANY - pages.length);
    await Promise.all([...new Set(secondWave)].slice(0, remaining).map(readPage));

    if (!pages.length) {
      report.errors.push("No pages could be read; extraction was skipped");
      report.outcome = "failed";
      report.stage = "fetch";
      return { rows: [], report };
    }

    if (deps.requireEcommerceEligibility) {
      const eligibility = assessEcommerceEligibility(pages);

      if (!eligibility.eligible) {
        report.errors.push(
          `Autonomous discovery rejected this candidate: ${eligibility.reason} ` +
          `Storefront signals: ${eligibility.commerceSignals.join(", ") || "none"}. ` +
          `Service signals: ${eligibility.serviceSignals.join(", ") || "none"}.`
        );
        report.outcome = "rejected";
        report.stage = "eligibility";
        return { rows: [], report };
      }

      // Necessary condition for the US gate below, checked for free before any
      // LLM call: the extractor only emits us_ecommerce claims backed by an
      // explicit US quotation, so pages with no US wording cannot pass.
      if (!pagesHaveUsEvidence(pages)) {
        report.errors.push(
          "Autonomous discovery rejected this candidate: no US-business wording (United States, USA, a US state address, US shipping...) appears anywhere in the first-party pages that were read."
        );
        report.outcome = "rejected";
        report.stage = "no_us_signal";
        return { rows: [], report };
      }
    }

    const extractGateFirst = async (): Promise<ProposedClaim[]> => {
      const collected: ProposedClaim[] = [];
      const used = new Set<string>();
      let passed = false;

      for (const page of rankPagesByUsEvidence(pages).slice(0, GATE_PAGE_LIMIT)) {
        used.add(page.url);
        collected.push(...(await extract(entry.companyName, [usEvidenceExcerpt(page)])));
        if (
          verifyClaims(collected, pages).accepted.some(
            (claim) => claim.claim_type === "us_ecommerce",
          )
        ) {
          passed = true;
          break;
        }
      }

      if (!passed) return collected;

      // Gate passed: now spend calls on what a salesperson needs. The homepage
      // stays eligible because the gate only read its US-evidence excerpt.
      used.delete(pages[0].url);
      const enrichment = selectEnrichmentPages(pages, used, ENRICHMENT_PAGE_LIMIT);
      if (enrichment.length) collected.push(...(await extract(entry.companyName, enrichment)));
      return collected;
    };

    let proposals: ProposedClaim[];

    try {
      proposals = deps.requireEcommerceEligibility
        ? await extractGateFirst()
        : await extract(entry.companyName, pages);
      report.proposed = proposals.length;
    } catch (error) {
      report.errors.push(
        `AI extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      report.outcome = "failed";
      report.stage = error instanceof AiUnavailableError ? "ai_unavailable" : "extraction";
      return { rows: [], report };
    }

    const verification = verifyClaims(proposals, pages);
    const retrievedAt = now().toISOString().slice(0, 10);

    report.accepted = verification.accepted.length;
    report.rejected = verification.rejected.length;
    report.rejectedClaims = verification.rejected.map((item) => ({
      claim_type: item.claim_type,
      reason: item.reason,
    }));

    if (
      deps.requireEcommerceEligibility &&
      !verification.accepted.some((claim) => claim.claim_type === "us_ecommerce")
    ) {
      report.errors.push(
        "Autonomous discovery rejected this candidate: no verified first-party evidence of US business presence or US e-commerce operations."
      );
      report.outcome = "rejected";
      report.stage = "us_evidence";
      return { rows: [], report };
    }

    const rows = verification.accepted.map((claim) => ({
      company_name: entry.companyName,
      website: entry.website,
      claim_type: claim.claim_type,
      claim: claim.claim,
      source_url: claim.source_url,
      source_title: claim.source_title,
      retrieved_at: retrievedAt,
      evidence: claim.evidence,
    }));

    report.outcome = rows.length ? "qualified" : "rejected";
    report.stage = rows.length ? "complete" : "no_claims";
    return { rows, report };
  };

  // A bounded worker pool prevents one slow company from blocking all others.
  // Store by input index so returned reports and rows remain deterministic.
  const results: Array<{
    rows: ResearchOutputRow[];
    report: CompanyResearchReport;
  } | undefined> = new Array(entries.length);

  let nextIndex = 0;
  let stopped = false;

  const worker = async () => {
    while (true) {
      if (stopped || deps.shouldStop?.()) {
        stopped = true;
        return;
      }
      const index = nextIndex++;
      if (index >= entries.length) return;
      results[index] = await researchCompany(entries[index]);
    }
  };

  const workerCount = Math.min(concurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    rows: results.flatMap((result) => result?.rows ?? []),
    companies: results.flatMap((result) => result ? [result.report] : []),
    notStarted: entries.filter((_, index) => !results[index]),
  };
}
