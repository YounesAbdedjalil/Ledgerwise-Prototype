// Orchestration for autonomous company discovery.
//
// The previous implementation ran ONE search round, took the first 12 surviving
// URLs, researched them, and stopped, so a rejected candidate was never
// replaced. This module keeps a pool of candidates and keeps drawing from it
// (searching again when the pool runs dry) until the target number of
// companies has been IMPORTED, a time budget is hit, or there is nothing left
// to try. Every external effect is injected so the loop is unit-testable.

import type {
  CompanyResearchReport,
  ResearchInputEntry,
  ResearchRunResult,
} from "./runner";

/* ------------------------------------------------------------------ */
/* Candidate extraction from search results                            */
/* ------------------------------------------------------------------ */

export type SearchHit = {
  url?: string;
  title?: string;
  content?: string;
  score?: number;
};

export type Candidate = {
  companyName: string;
  website: string; // https://host
  host: string;
  query: string;
};

export const BLOCKED_DOMAINS = [
  "google.com", "youtube.com", "facebook.com", "instagram.com",
  "linkedin.com", "tiktok.com", "wikipedia.org", "reddit.com", "pinterest.com",
  "quora.com", "x.com", "twitter.com",
  "crunchbase.com", "pitchbook.com", "owler.com", "zoominfo.com",
  "shopify.com", "bigcommerce.com", "woocommerce.com", "wix.com",
  "squarespace.com", "wordpress.com",
  "amazon.com", "walmart.com", "etsy.com", "ebay.com", "target.com",
  "aliexpress.com", "alibaba.com",
  "forbes.com", "bloomberg.com", "techcrunch.com", "businessinsider.com",
  "inc.com", "entrepreneur.com", "fastcompany.com", "nytimes.com", "wsj.com",
  "medium.com", "substack.com", "yelp.com", "trustpilot.com",
  "clutch.co", "g2.com", "capterra.com", "github.com", "hubspot.com",
];

export function isBlockedHost(host: string, blocked = BLOCKED_DOMAINS): boolean {
  return blocked.some((d) => host === d || host.endsWith(`.${d}`));
}

// Paths that identify a brand's own storefront even when the search engine
// returned a deep link: Shopify-style product/collection/page URLs, or a
// locale root such as /en-us/. Anything else (blog posts, listicles, news) is
// dropped because its host is probably a publisher, not a store.
const STOREFRONT_PATH =
  /^\/(?:products?|collections?|pages|shop|about|about-us|our-story|story)(?:\/|$)/i;
const LOCALE_ROOT = /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i;

const GENERIC_TITLE =
  /^(?:home|homepage|welcome|shop|shop all|online store|official site|official website|buy\b.*)$/i;

function hostLabel(host: string): string {
  const parts = host.split(".");
  let label = parts[parts.length - 2] ?? parts[0];
  if (["co", "com", "org", "net"].includes(label) && parts.length >= 3) {
    label = parts[parts.length - 3];
  }
  return label;
}

function titleCase(label: string): string {
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function pickCompanyName(title: string | undefined, host: string): string {
  const label = hostLabel(host);
  const key = norm(label);
  const parts = (title ?? "")
    .split(/\s+(?:\||—|–|-|:|·)\s+/)
    .map((p) => p.replace(/\s+(official website|official site|homepage)$/i, "").trim())
    .filter(Boolean);

  const matching = parts.find((p) => {
    const n = norm(p);
    return n.length >= 3 && key.length >= 3 && (n.includes(key) || key.includes(n));
  });
  if (matching) return matching.slice(0, 100);

  const firstUseful = parts.find((p) => p.length >= 2 && p.length <= 60 && !GENERIC_TITLE.test(p));
  return (firstUseful ?? titleCase(label)).slice(0, 100);
}

export type DropReason =
  | "invalid_url"
  | "not_https"
  | "blocked"
  | "article_path"
  | "low_score";

export function extractCandidates(
  hits: SearchHit[],
  query: string,
  opts: { minScore?: number; isBlocked?: (host: string) => boolean } = {},
): { candidates: Candidate[]; dropped: Record<DropReason, number> } {
  const minScore = opts.minScore ?? 0.2;
  const isBlocked = opts.isBlocked ?? ((h: string) => isBlockedHost(h));
  const dropped: Record<DropReason, number> = {
    invalid_url: 0, not_https: 0, blocked: 0, article_path: 0, low_score: 0,
  };
  const candidates: Candidate[] = [];

  for (const hit of hits) {
    if (!hit.url) { dropped.invalid_url++; continue; }
    let url: URL;
    try { url = new URL(hit.url); } catch { dropped.invalid_url++; continue; }

    if (url.protocol !== "https:") { dropped.not_https++; continue; }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) { dropped.invalid_url++; continue; }
    if (isBlocked(host)) { dropped.blocked++; continue; }

    const path = url.pathname;
    if (!(path === "/" || LOCALE_ROOT.test(path) || STOREFRONT_PATH.test(path))) {
      dropped.article_path++;
      continue;
    }

    if (typeof hit.score === "number" && hit.score < minScore) { dropped.low_score++; continue; }

    candidates.push({
      companyName: pickCompanyName(hit.title, host),
      website: `https://${host}`,
      host,
      query,
    });
  }

  return { candidates, dropped };
}

/* ------------------------------------------------------------------ */
/* Query bank (rotated between runs so repeats do not re-fetch the     */
/* same ten URLs)                                                      */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  "pet supplies", "skincare", "supplements", "women's apparel", "men's apparel",
  "outdoor gear", "home decor", "kitchenware", "specialty coffee", "loose leaf tea",
  "candles", "jewelry", "baby products", "fitness equipment", "sporting goods",
  "furniture", "stationery", "toys", "haircare", "footwear", "handbags",
  "hand tools", "automotive accessories", "craft supplies", "natural wellness",
  "gourmet snacks", "garden and plants", "eyewear", "watches", "bedding",
];

const TEMPLATES: Array<(category: string) => string> = [
  (c) => `${c} brand official online store ships across the USA`,
  (c) => `independent American ${c} company shop online founder story`,
  (c) => `${c} direct-to-consumer brand Shopify store United States`,
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic shuffle of the whole bank, so a seed fully determines a run. */
export function buildQueryPlan(seed: number, count: number): string[] {
  const all = CATEGORIES.flatMap((c) => TEMPLATES.map((t) => t(c)));
  const rand = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.max(0, count));
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

// Only judgements about the COMPANY are remembered. Fetch/AI failures are
// infrastructure problems and must be retried on a later run.
export const REMEMBERED_STAGES = new Set([
  "early_service", "eligibility", "no_us_signal", "us_evidence",
]);

export type Rejection = {
  host: string;
  companyName: string;
  stage: string;
  reason: string;
  query: string;
};

export type PersistResult = {
  companiesCreated: number;
  sourcesAdded: number;
  duplicatesSkipped: number;
  rejected: number; // rows the importer refused
  error?: string | null;
};

export type StopReason =
  | "target_reached"
  | "deadline"
  | "candidates_exhausted"
  | "search_failed"
  | "ai_unavailable"
  | "import_failed"
  | "research_limit";

export type DiscoveryLimits = {
  target: number;
  batchSize: number;
  queriesPerRound: number;
  maxSearchCalls: number;
  maxResearched: number;
  /** Absolute timestamp (same clock as deps.now) after which no new batch starts. */
  stopStartingBatchesAt: number;
};

export type DiscoveryDeps = {
  now: () => number;
  search: (query: string, excludeDomains: string[]) => Promise<SearchHit[]>;
  loadKnownHosts: () => Promise<Set<string>>;
  research: (entries: ResearchInputEntry[]) => Promise<ResearchRunResult>;
  persist: (research: ResearchRunResult) => Promise<PersistResult>;
  remember: (rejections: Rejection[]) => Promise<void>;
  queryPlan: string[];
  blockedDomains?: string[];
  minScore?: number;
};

export type QueryYield = {
  results: number;
  newCandidates: number;
  researched: number;
  qualified: number;
};

export type DiscoveryRun = {
  target: number;
  imported: number;
  sourcesAdded: number;
  duplicatesSkipped: number;
  importIssues: number;
  importError: string | null;
  stopReason: StopReason;
  elapsedMs: number;
  searches: { calls: number; failures: number; byQuery: Record<string, QueryYield> };
  funnel: {
    rawResults: number;
    dropped: Record<string, number>;
    newCandidates: number;
    researched: number;
    qualified: number;
    byStage: Record<string, number>;
  };
  reports: (CompanyResearchReport & { query: string })[];
};

export async function runDiscovery(
  limits: DiscoveryLimits,
  deps: DiscoveryDeps,
): Promise<DiscoveryRun> {
  const startedAt = deps.now();
  const blocked = deps.blockedDomains ?? BLOCKED_DOMAINS;

  const known = await deps.loadKnownHosts();
  const seen = new Set(known);
  const pending: Candidate[] = [];
  const queryOf = new Map<string, string>(); // website -> query

  const run: DiscoveryRun = {
    target: limits.target,
    imported: 0,
    sourcesAdded: 0,
    duplicatesSkipped: 0,
    importIssues: 0,
    importError: null,
    stopReason: "candidates_exhausted",
    elapsedMs: 0,
    searches: { calls: 0, failures: 0, byQuery: {} },
    funnel: {
      rawResults: 0,
      dropped: { invalid_url: 0, not_https: 0, blocked: 0, article_path: 0, low_score: 0, already_known: 0, duplicate: 0 },
      newCandidates: 0,
      researched: 0,
      qualified: 0,
      byStage: {},
    },
    reports: [],
  };

  const yieldFor = (q: string): QueryYield =>
    (run.searches.byQuery[q] ??= { results: 0, newCandidates: 0, researched: 0, qualified: 0 });

  let queryIndex = 0;
  let consecutiveDeadRounds = 0;
  let aiDown = false;

  const canSearch = () =>
    queryIndex < deps.queryPlan.length &&
    run.searches.calls < limits.maxSearchCalls &&
    consecutiveDeadRounds < 2;

  const excludeList = () =>
    [...blocked, ...[...seen].slice(0, 40)].slice(0, 100);

  async function searchRound() {
    const queries = deps.queryPlan.slice(queryIndex, queryIndex + limits.queriesPerRound);
    queryIndex += queries.length;
    run.searches.calls += queries.length;

    const exclude = excludeList();
    const settled = await Promise.allSettled(queries.map((q) => deps.search(q, exclude)));
    let okCount = 0;

    settled.forEach((result, i) => {
      const query = queries[i];
      if (result.status === "rejected") {
        run.searches.failures++;
        return;
      }
      okCount++;
      run.funnel.rawResults += result.value.length;
      yieldFor(query).results += result.value.length;

      const { candidates, dropped } = extractCandidates(result.value, query, {
        minScore: deps.minScore,
        isBlocked: (h) => isBlockedHost(h, blocked),
      });
      for (const [reason, n] of Object.entries(dropped)) {
        run.funnel.dropped[reason] = (run.funnel.dropped[reason] ?? 0) + n;
      }

      for (const c of candidates) {
        if (known.has(c.host)) { run.funnel.dropped.already_known++; continue; }
        if (seen.has(c.host)) { run.funnel.dropped.duplicate++; continue; }
        seen.add(c.host);
        pending.push(c);
        queryOf.set(c.website, query);
        run.funnel.newCandidates++;
        yieldFor(query).newCandidates++;
      }
    });

    consecutiveDeadRounds = okCount === 0 ? consecutiveDeadRounds + 1 : 0;
  }

  while (true) {
    if (run.imported >= limits.target) { run.stopReason = "target_reached"; break; }
    if (deps.now() >= limits.stopStartingBatchesAt) { run.stopReason = "deadline"; break; }
    if (aiDown) { run.stopReason = "ai_unavailable"; break; }
    if (run.funnel.researched >= limits.maxResearched) { run.stopReason = "research_limit"; break; }

    // Keep the pool topped up so every batch is full and rejects are replaced.
    if (pending.length < limits.batchSize && canSearch()) {
      await searchRound();
      if (pending.length === 0) continue; // loop re-checks time/limits first
    }

    if (pending.length === 0) {
      run.stopReason =
        run.searches.calls > 0 && run.searches.failures === run.searches.calls
          ? "search_failed"
          : "candidates_exhausted";
      break;
    }

    const size = Math.min(
      limits.batchSize,
      limits.target - run.imported, // a batch can add at most one company per entry, so the target is never overshot
      limits.maxResearched - run.funnel.researched,
    );
    const batch = pending.splice(0, size);
    run.funnel.researched += batch.length;
    batch.forEach((c) => yieldFor(c.query).researched++);

    const research = await deps.research(
      batch.map((c) => ({ companyName: c.companyName, website: c.website, extraUrls: [] })),
    );

    const rejections: Rejection[] = [];
    for (const report of research.companies) {
      const query = queryOf.get(report.website) ?? "";
      run.reports.push({ ...report, query });

      const stage = report.stage ?? "unknown";
      run.funnel.byStage[stage] = (run.funnel.byStage[stage] ?? 0) + 1;

      if (report.outcome === "qualified") {
        run.funnel.qualified++;
        yieldFor(query).qualified++;
      }
      if (report.stage === "ai_unavailable") aiDown = true;

      if (report.outcome === "rejected" && report.stage && REMEMBERED_STAGES.has(report.stage)) {
        let host = "";
        try { host = new URL(report.website).hostname.replace(/^www\./, ""); } catch { /* skip */ }
        if (host) {
          rejections.push({
            host,
            companyName: report.companyName,
            stage: report.stage,
            reason: report.errors[report.errors.length - 1] ?? "",
            query,
          });
        }
      }
    }
    if (rejections.length) await deps.remember(rejections);

    if (research.rows.length) {
      const persisted = await deps.persist(research);
      run.imported += persisted.companiesCreated;
      run.sourcesAdded += persisted.sourcesAdded;
      run.duplicatesSkipped += persisted.duplicatesSkipped;
      run.importIssues += persisted.rejected;
      if (persisted.error) {
        run.importError = persisted.error;
        run.stopReason = "import_failed";
        break;
      }
    }

    // Companies the runner declined to start because the time budget ran out
    // were never judged; they are simply left for the next run.
    if (research.notStarted?.length && run.imported < limits.target) {
      run.stopReason = "deadline";
      break;
    }
  }

  run.elapsedMs = deps.now() - startedAt;
  return run;
}
