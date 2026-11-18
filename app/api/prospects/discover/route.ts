import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runResearch } from "@/lib/research/runner";
import { extractClaims } from "@/lib/research/extract";
import { discoverSameSiteLinks } from "@/lib/research/pages";
import {
  BLOCKED_DOMAINS,
  buildQueryPlan,
  runDiscovery,
  type PersistResult,
  type SearchHit,
} from "@/lib/research/discovery";
import { hostFromUrl, type RawRow } from "@/lib/import-schema";
import { importRows } from "@/app/(dashboard)/prospects/import/actions";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---- Budgets (one request = at most maxDuration seconds) -----------------
// Batches are persisted as they finish, so a platform timeout can lose at most
// the batch in flight. No new batch starts after START_BATCHES_UNTIL_MS, and
// the research runner stops starting new companies after RUNNER_STOP_MS.
const START_BATCHES_UNTIL_MS = 185_000;
const RUNNER_STOP_MS = 230_000;
const DEFAULT_TARGET = 30;
const MAX_TARGET = 30;
const BATCH_SIZE = 4; // matches the runner's default concurrency
const QUERIES_PER_ROUND = 2;
const MAX_SEARCH_CALLS = 10; // Tavily credits per request (basic search = 1 each)
const MAX_RESEARCHED = 80;
const MAX_PAGES_PER_COMPANY = 6;
const NEGATIVE_CACHE_DAYS = 30;

async function searchTavily(query: string, excludeDomains: string[]): Promise<SearchHit[]> {
  const call = (withExclude: boolean) =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 20, // Tavily's per-call maximum; the old code asked for 10
        include_answer: false,
        include_raw_content: false,
        ...(withExclude && excludeDomains.length ? { exclude_domains: excludeDomains } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    });

  let response = await call(true);
  // If the exclude list is ever rejected, degrade to an unfiltered search
  // rather than losing the whole round.
  if (response.status === 400 && excludeDomains.length) response = await call(false);

  if (!response.ok) throw new Error(`Tavily search failed: HTTP ${response.status}`);

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

// PostgREST caps a response (1000 rows by default), so page through it.
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
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

  const { data: organizationId } = await supabase.rpc("current_organization_id");
  const { data: canDiscover } = organizationId
    ? await supabase.rpc("has_org_role", {
        p_org: organizationId,
        p_roles: ["owner", "admin", "member"],
      })
    : { data: false };
  if (!canDiscover) {
    return NextResponse.json({ error: "You do not have permission to run discovery." }, { status: 403 });
  }

  if (!process.env.TAVILY_API_KEY) {
    return NextResponse.json({ error: "TAVILY_API_KEY is not configured." }, { status: 503 });
  }

  const { data: quotaAllowed, error: quotaError } = await supabase.rpc("consume_organization_quota", {
    p_meter: "discovery",
  });
  if (quotaError) return NextResponse.json({ error: "Could not check organization usage." }, { status: 503 });
  if (!quotaAllowed) return NextResponse.json({ error: "Daily organization discovery limit reached." }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const requested = Number.parseInt(String(body?.target ?? ""), 10);
  const target = Math.min(MAX_TARGET, Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_TARGET));

  const startedAt = Date.now();
  let negativeCache: "active" | "unavailable" = "active";

  try {
    const run = await runDiscovery(
      {
        target,
        batchSize: BATCH_SIZE,
        queriesPerRound: QUERIES_PER_ROUND,
        maxSearchCalls: MAX_SEARCH_CALLS,
        maxResearched: MAX_RESEARCHED,
        stopStartingBatchesAt: startedAt + START_BATCHES_UNTIL_MS,
      },
      {
        now: Date.now,
        // A fresh seed each request means each click draws different queries;
        // the old code sent the same three queries every time.
        queryPlan: buildQueryPlan(startedAt, MAX_SEARCH_CALLS),
        blockedDomains: BLOCKED_DOMAINS,
        search: searchTavily,

        loadKnownHosts: async () => {
          const companies = await fetchAll<{ website: string }>((from, to) =>
            supabase.from("companies").select("website").range(from, to)
          );
          const hosts = new Set(
            companies
              .map((row) => hostFromUrl(row.website))
              .filter((host): host is string => Boolean(host))
          );

          // Remembered rejections (see supabase/migrations/..._06). If the
          // migration has not been applied the run still works, but rejected
          // sites will be re-researched on the next run.
          try {
            const cutoff = new Date(Date.now() - NEGATIVE_CACHE_DAYS * 86_400_000).toISOString();
            const rejected = await fetchAll<{ host: string }>((from, to) =>
              supabase.from("discovery_candidates").select("host").gte("checked_at", cutoff).range(from, to)
            );
            rejected.forEach((row) => hosts.add(row.host));
          } catch (error) {
            negativeCache = "unavailable";
            console.warn("discovery_candidates unavailable:", error);
          }
          return hosts;
        },

        research: (entries) =>
          runResearch(entries, {
            requireEcommerceEligibility: true,
            maxPagesPerCompany: MAX_PAGES_PER_COMPANY,
            shouldStop: () => Date.now() - startedAt >= RUNNER_STOP_MS,
            // BUG FIX: the previous wrapper ignored the runner's maxLinks
            // argument and always returned ONE link, which capped every
            // company at three pages (homepage + one about-type page + one
            // more) and starved the eligibility and US-evidence checks.
            discoverLinks: (text, baseUrl, maxLinks) =>
              discoverSameSiteLinks(text, baseUrl, maxLinks ?? 3),
            extract: (name, pages) =>
              extractClaims(name, pages, { maxChunksPerPage: 1, skipMalformedChunks: true }),
          }),

        persist: async (research): Promise<PersistResult> => {
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
          const imported = await importRows(rows, "autonomous_discovery");
          return {
            companiesCreated: imported.companiesCreated,
            sourcesAdded: imported.sourcesAdded,
            duplicatesSkipped: imported.duplicatesSkipped,
            rejected: imported.rejected.length,
            error: imported.error ?? null,
          };
        },

        remember: async (rejections) => {
          if (negativeCache === "unavailable") return;
          const { error } = await supabase.from("discovery_candidates").upsert(
            rejections.map((r) => ({
              host: r.host,
              company_name: r.companyName.slice(0, 200),
              status: "rejected",
              stage: r.stage,
              reason: r.reason.slice(0, 500),
              query: r.query.slice(0, 300),
              checked_at: new Date().toISOString(),
              checked_by: user.id,
            })),
            { onConflict: "organization_id,host" }
          );
          if (error) {
            negativeCache = "unavailable";
            console.warn("Could not record discovery rejections:", error.message);
          }
        },
      }
    );

    revalidatePath("/prospects");
    revalidatePath("/prospects/review");

    const remaining = Math.max(0, run.target - run.imported);

    return NextResponse.json({
      // Outcome of THIS request. The client may call again for the remainder.
      target: run.target,
      imported: run.imported,
      remaining,
      stopReason: run.stopReason,
      canContinue:
        remaining > 0 &&
        ["deadline", "research_limit", "candidates_exhausted"].includes(run.stopReason),
      elapsedMs: run.elapsedMs,
      negativeCache,

      // Where candidates were lost, stage by stage, and which queries paid off.
      funnel: run.funnel,
      searches: run.searches,

      // Fields the existing button already reads.
      candidatesFound: run.funnel.newCandidates,
      researched: run.funnel.researched,
      companiesWithEvidence: run.funnel.qualified,
      companiesCreated: run.imported,
      sourcesAdded: run.sourcesAdded,
      duplicatesSkipped: run.duplicatesSkipped,
      rejected: run.importIssues,
      searchFailures: run.searches.failures,
      importError: run.importError,

      reports: run.reports.map((report) => ({
        company: report.companyName,
        website: report.website,
        outcome: report.outcome,
        stage: report.stage,
        query: report.query,
        pagesRead: report.pagesRead.length,
        accepted: report.accepted,
        rejected: report.rejected,
        errors: report.errors.map((message) => message.slice(0, 400)),
      })),
    });
  } catch (error) {
    console.error("Company discovery failed:", error);
    revalidatePath("/prospects");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Company discovery failed." },
      { status: 500 }
    );
  }
}
