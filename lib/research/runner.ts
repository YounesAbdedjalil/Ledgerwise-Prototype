import { discoverSameSiteLinks, fetchResearchPage, validateResearchUrl } from "./pages";
import { extractClaims } from "./extract";
import { verifyClaims, type ProposedClaim, type ResearchPage } from "./verify";

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

export type CompanyResearchReport = {
  companyName: string;
  website: string;
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
};

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

    // Read the homepage first so we can discover relevant same-site pages.
    await readPage(entry.website);

    const discovered = pages.length
      ? discoverLinks(pages[0].text, entry.website, 3)
      : [];

    // Fetch additional pages concurrently, after the homepage is available.
    const additionalUrls = [...new Set([...entry.extraUrls, ...discovered])];
    await Promise.all(additionalUrls.map(readPage));

    if (!pages.length) {
      report.errors.push("No pages could be read; extraction was skipped");
      return { rows: [], report };
    }

    let proposals: ProposedClaim[];

    try {
      proposals = await extract(entry.companyName, pages);
      report.proposed = proposals.length;
    } catch (error) {
      report.errors.push(
        `AI extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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

    return { rows, report };
  };

  // A bounded worker pool prevents one slow company from blocking all others.
  // Store by input index so returned reports and rows remain deterministic.
  const results: Array<{
    rows: ResearchOutputRow[];
    report: CompanyResearchReport;
  } | undefined> = new Array(entries.length);

  let nextIndex = 0;

  const worker = async () => {
    while (true) {
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
  };
}
