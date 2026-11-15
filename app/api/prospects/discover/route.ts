import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runResearch } from "@/lib/research/runner";
import { discoverSameSiteLinks } from "@/lib/research/pages";
import { hostFromUrl, type RawRow } from "@/lib/import-schema";
import { importRows } from "@/app/(dashboard)/prospects/import/actions";

export const runtime = "nodejs";
export const maxDuration = 300;

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

// Keep discovery to a small number of focused basic-search calls so a normal
// run remains practical on free-tier Tavily quotas.
const QUERIES = [
  'US direct-to-consumer ecommerce brands official website Shopify -directory',
  'United States online retail consumer brands hiring careers expansion official',
  'American ecommerce brands founder team about us online store',
];

const BLOCKED_DOMAINS = [
  "google.com", "youtube.com", "facebook.com", "instagram.com",
  "linkedin.com", "tiktok.com", "wikipedia.org", "reddit.com",
  "crunchbase.com", "pitchbook.com", "owler.com", "zoominfo.com",
  "shopify.com", "amazon.com", "walmart.com", "etsy.com",
  "forbes.com", "bloomberg.com", "techcrunch.com", "businessinsider.com",
  "medium.com", "substack.com", "yelp.com", "trustpilot.com",
  "clutch.co", "g2.com", "capterra.com",
];

function isBlocked(host: string) {
  return BLOCKED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

function nameFromTitle(title: string) {
  return title
    .split(/\s(?:\||—|–|-)\s/)[0]
    .replace(/\s+(official website|official site|homepage)$/i, "")
    .trim()
    .slice(0, 100);
}

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "TAVILY_API_KEY is not configured." }, { status: 503 });
  }

  try {
    const searchResults = await Promise.allSettled(
      QUERIES.map(searchTavily)
    );

    const candidates = new Map<string, { companyName: string; website: string }>();
    let searchFailures = 0;

    for (const result of searchResults) {
      if (result.status === "rejected") {
        searchFailures++;
        continue;
      }

      for (const item of result.value) {
        if (!item.url || !item.title) continue;

        try {
          const url = new URL(item.url);
          if (url.protocol !== "https:" || url.pathname !== "/" || url.search) continue;

          const host = url.hostname.toLowerCase().replace(/^www\./, "");
          if (!host.includes(".") || isBlocked(host)) continue;
          if (typeof item.score === "number" && item.score < 0.3) continue;

          const companyName = nameFromTitle(item.title);
          if (!companyName || companyName.length < 2) continue;

          const website = `https://${host}`;
          candidates.set(host, { companyName, website });
        } catch {
          // Ignore malformed search results.
        }
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("companies")
      .select("website");

    if (existingError) throw new Error(existingError.message);

    const existingHosts = new Set(
      (existing ?? [])
        .map((row) => hostFromUrl(row.website))
        .filter((host): host is string => Boolean(host))
    );

    const newCandidates = [...candidates.entries()]
      .filter(([host]) => !existingHosts.has(host))
      .slice(0, 12)
      .map(([, candidate]) => candidate);

    if (!newCandidates.length) {
      return NextResponse.json({
        message: "No new candidate websites were found. Try again later.",
        candidatesFound: candidates.size,
        researched: 0,
        companiesCreated: 0,
        sourcesAdded: 0,
        searchFailures,
      });
    }

    const research = await runResearch(
      newCandidates.map((candidate) => ({
        ...candidate,
        extraUrls: [],
      })),
      {
        // The research runner caps each company at eight pages; twelve
        // companies per request bounds free-tier AI and reader usage.
        discoverLinks: (text, baseUrl) =>
          discoverSameSiteLinks(text, baseUrl, 1),
        requireEcommerceEligibility: true,
      }
    );

    const rows: RawRow[] = research.rows.map((row) => ({
      company_name: row.company_name,
      website: row.website,
      claim_type: row.claim_type,
      claim: row.claim,
      source_url: row.source_url,
      source_title: row.source_title,
      retrieved_at: row.retrieved_at,
      evidence: row.evidence,
    }));

    const imported = rows.length
      ? await importRows(rows, "autonomous_discovery")
      : {
          companiesCreated: 0,
          sourcesAdded: 0,
          duplicatesSkipped: 0,
          rejected: [],
        };

    revalidatePath("/prospects");
    revalidatePath("/prospects/review");

    return NextResponse.json({
      candidatesFound: candidates.size,
      researched: newCandidates.length,
      companiesWithEvidence: new Set(research.rows.map((row) => row.website)).size,
      companiesCreated: imported.companiesCreated,
      sourcesAdded: imported.sourcesAdded,
      duplicatesSkipped: imported.duplicatesSkipped,
      rejected: imported.rejected.length,
      searchFailures,
      reports: research.companies.map((company) => ({
        company: company.companyName,
        website: company.website,
        pagesRead: company.pagesRead.length,
        accepted: company.accepted,
        rejected: company.rejected,
        errors: company.errors,
      })),
      importError: imported.error ?? null,
    });
  } catch (error) {
    console.error("Company discovery failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Company discovery failed." },
      { status: 500 }
    );
  }
}
