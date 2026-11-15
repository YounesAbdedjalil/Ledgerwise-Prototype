import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQueryPlan,
  extractCandidates,
  pickCompanyName,
  runDiscovery,
  type DiscoveryDeps,
  type DiscoveryLimits,
  type SearchHit,
} from "../lib/research/discovery";
import type {
  CompanyResearchReport,
  ResearchInputEntry,
  ResearchRunResult,
  ResearchStage,
} from "../lib/research/runner";

/* ---------- candidate extraction ---------- */

test("keeps brand roots (even with tracking params) and storefront deep links", () => {
  const { candidates, dropped } = extractCandidates(
    [
      { url: "https://www.pawsco.com/?utm_source=x", title: "Paws Co | Dog toys", score: 0.9 },
      { url: "https://brewhouse.co/collections/beans", title: "Beans – Brewhouse Coffee", score: 0.7 },
      { url: "https://en.example-shop.com/en-us/", title: "Home", score: 0.6 },
    ],
    "q",
  );
  assert.deepEqual(candidates.map((c) => c.host), ["pawsco.com", "brewhouse.co", "en.example-shop.com"]);
  assert.equal(candidates[0].website, "https://pawsco.com");
  assert.equal(Object.values(dropped).reduce((a, b) => a + b, 0), 0);
});

test("drops blog/listicle URLs, blocked hosts, http, junk and low scores, and counts why", () => {
  const { candidates, dropped } = extractCandidates(
    [
      { url: "https://somepublisher.com/blog/best-shopify-stores", title: "Best Shopify stores", score: 0.9 },
      { url: "https://www.forbes.com/", title: "Forbes", score: 0.9 },
      { url: "http://insecure.com/", title: "Insecure", score: 0.9 },
      { url: "not a url", title: "x" },
      { url: "https://lowscore.com/", title: "Low", score: 0.05 },
      { title: "no url" },
    ],
    "q",
  );
  assert.equal(candidates.length, 0);
  assert.deepEqual(dropped, {
    invalid_url: 2, not_https: 1, blocked: 1, article_path: 1, low_score: 1,
  });
});

test("derives a sensible company name from noisy titles", () => {
  assert.equal(pickCompanyName("Home | Paws Co - Dog toys", "pawsco.com"), "Paws Co");
  assert.equal(pickCompanyName("Welcome", "brew-house.com"), "Brew House");
  assert.equal(pickCompanyName("Brewhouse Coffee Official Website", "brewhouse.co"), "Brewhouse Coffee");
  assert.equal(pickCompanyName(undefined, "shop.acme.co.uk"), "Acme");
});

test("query plan is deterministic per seed, varies across seeds, and has no repeats", () => {
  const a = buildQueryPlan(1, 12);
  assert.deepEqual(a, buildQueryPlan(1, 12));
  assert.notDeepEqual(a, buildQueryPlan(2, 12));
  assert.equal(new Set(a).size, 12);
});

/* ---------- discovery loop ---------- */

type Harness = {
  limits: DiscoveryLimits;
  deps: DiscoveryDeps;
  state: {
    clock: number;
    searchedQueries: string[];
    researchedHosts: string[];
    persistedHosts: string[];
    remembered: { host: string; stage: string }[];
    excludeLists: string[][];
  };
};

function hostOf(entry: ResearchInputEntry) {
  return new URL(entry.website).hostname;
}

/**
 * hits(i) returns the search results for the i-th search call.
 * stageOf(host) decides how each candidate ends.
 */
function harness(opts: {
  hits: (callIndex: number) => SearchHit[] | Error;
  stageOf: (host: string) => ResearchStage;
  known?: string[];
  limits?: Partial<DiscoveryLimits>;
  queries?: number;
  tickPerResearch?: number;
  persistError?: string;
  notStartedAfter?: number; // research call index (1-based) that returns notStarted
}): Harness {
  const state: Harness["state"] = {
    clock: 0, searchedQueries: [], researchedHosts: [], persistedHosts: [], remembered: [], excludeLists: [],
  };
  let searchCalls = 0;
  let researchCalls = 0;

  const limits: DiscoveryLimits = {
    target: 5, batchSize: 4, queriesPerRound: 2, maxSearchCalls: 20, maxResearched: 200,
    stopStartingBatchesAt: 1_000_000,
    ...opts.limits,
  };

  const deps: DiscoveryDeps = {
    now: () => state.clock,
    queryPlan: Array.from({ length: opts.queries ?? 20 }, (_, i) => `query-${i}`),
    search: async (query, exclude) => {
      state.searchedQueries.push(query);
      state.excludeLists.push(exclude);
      const out = opts.hits(searchCalls++);
      if (out instanceof Error) throw out;
      return out;
    },
    loadKnownHosts: async () => new Set(opts.known ?? []),
    research: async (entries): Promise<ResearchRunResult> => {
      researchCalls++;
      state.clock += opts.tickPerResearch ?? 1;
      const companies: CompanyResearchReport[] = [];
      const rows: ResearchRunResult["rows"] = [];
      for (const entry of entries) {
        const host = hostOf(entry);
        state.researchedHosts.push(host);
        const stage = opts.stageOf(host);
        const outcome = stage === "complete" ? "qualified" : stage === "fetch" || stage === "ai_unavailable" || stage === "extraction" ? "failed" : "rejected";
        companies.push({
          companyName: entry.companyName, website: entry.website, outcome, stage,
          pagesRead: [], proposed: 0, accepted: outcome === "qualified" ? 1 : 0, rejected: 0,
          errors: [`why-${stage}`], rejectedClaims: [],
        });
        if (outcome === "qualified") {
          rows.push({
            company_name: entry.companyName, website: entry.website, claim_type: "us_ecommerce",
            claim: "c", source_url: entry.website, source_title: "t", retrieved_at: "2026-11-15", evidence: "e",
          });
        }
      }
      const notStarted =
        opts.notStartedAfter === researchCalls ? entries.slice(Math.ceil(entries.length / 2)) : [];
      return { rows, companies, notStarted };
    },
    persist: async (research) => {
      const hosts = [...new Set(research.rows.map((r) => new URL(r.website).hostname))];
      state.persistedHosts.push(...hosts);
      return {
        companiesCreated: opts.persistError ? 0 : hosts.length,
        sourcesAdded: research.rows.length, duplicatesSkipped: 0, rejected: 0,
        error: opts.persistError ?? null,
      };
    },
    remember: async (rejections) => {
      state.remembered.push(...rejections.map((r) => ({ host: r.host, stage: r.stage })));
    },
  };

  return { limits, deps, state };
}

// 8 fresh brand hosts per search call
const hitsPerCall = (i: number): SearchHit[] =>
  Array.from({ length: 8 }, (_, k) => ({ url: `https://brand${i}x${k}.com/`, title: `Brand ${i}x${k}`, score: 0.8 }));

// every third host qualifies; the rest are rejected for eligibility
const everyThird = (host: string): ResearchStage => {
  const n = Number(host.match(/x(\d+)\./)?.[1]);
  return n % 3 === 0 ? "complete" : "eligibility";
};

test("keeps searching for replacements until the target is imported", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: everyThird, limits: { target: 7 } });
  const run = await runDiscovery(h.limits, h.deps);

  assert.equal(run.stopReason, "target_reached");
  assert.equal(run.imported, 7);
  // Only ~3 in 8 candidates qualify, so reaching 7 must have researched well over 7.
  assert.ok(run.funnel.researched > 14, `researched ${run.funnel.researched}`);
  assert.ok(run.searches.calls > 2, "must have searched again after the first round");
});

test("never overshoots the target even when a whole batch would qualify", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: () => "complete", limits: { target: 6, batchSize: 4 } });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.imported, 6);
  assert.equal(run.funnel.researched, 6);
});

test("skips hosts already in the database or negative cache and never researches a host twice", async () => {
  const dup: SearchHit[] = [
    { url: "https://known.com/", title: "Known" },
    { url: "https://fresh.com/", title: "Fresh" },
    { url: "https://fresh.com/products/a", title: "Fresh product" },
  ];
  const h = harness({ hits: () => dup, stageOf: () => "complete", known: ["known.com"], limits: { target: 1 }, queries: 1 });
  const run = await runDiscovery(h.limits, h.deps);
  assert.deepEqual(h.state.researchedHosts, ["fresh.com"]);
  assert.equal(run.funnel.dropped.already_known, 1);
  assert.equal(run.funnel.dropped.duplicate, 1);
});

test("remembers only company judgements, never transient fetch/AI failures", async () => {
  const stages: Record<string, ResearchStage> = {
    "a.com": "eligibility", "b.com": "no_us_signal", "c.com": "us_evidence",
    "d.com": "fetch", "e.com": "complete",
  };
  const h = harness({
    hits: () => Object.keys(stages).map((host) => ({ url: `https://${host}/`, title: host })),
    stageOf: (host) => stages[host],
    limits: { target: 1, batchSize: 5 },
    queries: 1,
  });
  await runDiscovery(h.limits, h.deps);
  assert.deepEqual(
    h.state.remembered.map((r) => r.host).sort(),
    ["a.com", "b.com", "c.com"],
  );
});

test("stops with candidates_exhausted when the query plan runs out", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: () => "eligibility", queries: 4, limits: { target: 30 } });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "candidates_exhausted");
  assert.equal(run.searches.calls, 4);
  assert.equal(run.imported, 0);
});

test("reports search_failed when every search errors", async () => {
  const h = harness({ hits: () => new Error("HTTP 429"), stageOf: () => "complete", queries: 6 });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "search_failed");
  assert.equal(run.searches.failures, run.searches.calls);
});

test("honours the time budget: no new batch starts after the deadline", async () => {
  const h = harness({
    hits: hitsPerCall, stageOf: () => "eligibility",
    tickPerResearch: 10, limits: { target: 30, stopStartingBatchesAt: 35 },
  });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "deadline");
  assert.equal(h.state.researchedHosts.length, 16); // 4 batches of 4 at t=0,10,20,30
});

test("stops promptly when the AI provider is down instead of burning candidates", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: () => "ai_unavailable", limits: { target: 30 } });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "ai_unavailable");
  assert.equal(h.state.researchedHosts.length, 4); // one batch only
  assert.deepEqual(h.state.remembered, []);
});

test("companies the runner never started are left for the next run, not judged", async () => {
  const h = harness({
    hits: hitsPerCall, stageOf: () => "eligibility", limits: { target: 30 }, notStartedAfter: 1,
  });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "deadline");
  assert.equal(run.reports.length, 4); // reports exist only for started companies
});

test("a failed import stops the run and surfaces the error", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: () => "complete", persistError: "permission denied" });
  const run = await runDiscovery(h.limits, h.deps);
  assert.equal(run.stopReason, "import_failed");
  assert.equal(run.importError, "permission denied");
});

test("attributes qualified companies to the query that found them", async () => {
  const h = harness({ hits: hitsPerCall, stageOf: () => "complete", limits: { target: 3 } });
  const run = await runDiscovery(h.limits, h.deps);
  const totalQualified = Object.values(run.searches.byQuery).reduce((n, q) => n + q.qualified, 0);
  assert.equal(totalQualified, 3);
  assert.ok(run.reports.every((r) => r.query.startsWith("query-")));
});
