import test from "node:test";
import assert from "node:assert/strict";
import { runResearch } from "../lib/research/runner";
import { extractClaims } from "../lib/research/extract";
import { AiUnavailableError } from "../lib/ai";
import type { AiResponse } from "../lib/ai";
import type { ProposedClaim, ResearchPage } from "../lib/research/verify";

const EVIDENCE = "Our warehouse is located in Austin, TX 78701 and we ship across the US.";

const storeHome: ResearchPage = {
  url: "https://store.example/",
  title: "Store",
  text: `Shop all collections. Add to cart. Proceed to checkout. ${EVIDENCE}`,
};
const aboutPage: ResearchPage = {
  url: "https://store.example/pages/about",
  title: "About",
  text: "Founded in 2019 by Jane Doe, our CEO. We are hiring a finance manager.",
};

const entry = { companyName: "Store", website: "https://store.example/", extraUrls: [] };

function pagesFetcher(pages: ResearchPage[]) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  return async (url: string) => {
    const page = byUrl.get(url);
    if (!page) throw new Error(`404 ${url}`);
    return page;
  };
}

const usClaim = (page: ResearchPage): ProposedClaim => ({
  claim_type: "us_ecommerce",
  claim: "Operates from Austin, TX and ships across the US",
  source_url: page.url,
  evidence: EVIDENCE,
});

test("autonomous: gate-first extraction qualifies with two LLM calls and a compact gate prompt", async () => {
  const calls: { urls: string[]; chars: number }[] = [];

  const result = await runResearch([entry], {
    requireEcommerceEligibility: true,
    fetchPage: pagesFetcher([storeHome, aboutPage]),
    discoverLinks: () => [aboutPage.url],
    extract: async (_name, pages) => {
      calls.push({ urls: pages.map((p) => p.url), chars: pages.reduce((n, p) => n + p.text.length, 0) });
      return pages.some((p) => p.text.includes("Austin")) ? [usClaim(storeHome)] : [];
    },
  });

  assert.equal(result.companies[0].outcome, "qualified");
  assert.equal(result.companies[0].stage, "complete");
  assert.equal(result.rows.length, 1);
  // call 1 = gate on the US-evidence page, call 2 = enrichment on the about page
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].urls, [storeHome.url]);
  assert.ok(calls[1].urls.includes(aboutPage.url), "enrichment must read the about page");
  assert.ok(calls[1].urls.length <= 2);
});

test("autonomous: no US wording anywhere is rejected before any LLM call", async () => {
  let extractCalls = 0;
  const home = { ...storeHome, text: "Shop all collections. Add to cart. Proceed to checkout. We ship worldwide." };

  const result = await runResearch([entry], {
    requireEcommerceEligibility: true,
    fetchPage: pagesFetcher([home]),
    discoverLinks: () => [],
    extract: async () => { extractCalls++; return []; },
  });

  assert.equal(extractCalls, 0);
  assert.equal(result.companies[0].outcome, "rejected");
  assert.equal(result.companies[0].stage, "no_us_signal");
});

test("autonomous: if the gate pages yield no verified US claim, enrichment is skipped (<= 2 calls)", async () => {
  let extractCalls = 0;
  const result = await runResearch([entry], {
    requireEcommerceEligibility: true,
    fetchPage: pagesFetcher([storeHome, aboutPage]),
    discoverLinks: () => [aboutPage.url],
    extract: async () => { extractCalls++; return []; },
  });

  assert.equal(result.companies[0].stage, "us_evidence");
  assert.equal(result.companies[0].outcome, "rejected");
  assert.equal(extractCalls, 1); // only one page carries US wording, so one gate call
  assert.equal(result.rows.length, 0);
});

test("autonomous: an AI outage is a 'failed' outcome with its own stage, not a rejection", async () => {
  const result = await runResearch([entry], {
    requireEcommerceEligibility: true,
    fetchPage: pagesFetcher([storeHome]),
    discoverLinks: () => [],
    extract: async () => { throw new AiUnavailableError(["gemini: HTTP 429"]); },
  });

  assert.equal(result.companies[0].outcome, "failed");
  assert.equal(result.companies[0].stage, "ai_unavailable");
});

test("autonomous: a service-business homepage is rejected after one fetch", async () => {
  let fetches = 0;
  const ecomCfo: ResearchPage = {
    url: "https://cfo.example/",
    title: "Ecom CFO",
    text: "We provide bookkeeping services and fractional CFO services for e-commerce brands. Our consulting team helps you grow.",
  };

  const result = await runResearch(
    [{ companyName: "Ecom CFO", website: "https://cfo.example/", extraUrls: [] }],
    {
      requireEcommerceEligibility: true,
      fetchPage: async (url) => { fetches++; return { ...ecomCfo, url }; },
      discoverLinks: () => ["https://cfo.example/a", "https://cfo.example/b", "https://cfo.example/c"],
      extract: async () => [],
    },
  );

  assert.equal(fetches, 1);
  assert.equal(result.companies[0].stage, "early_service");
});

test("manual research is untouched: no gate, no US prefilter, single extract over all pages", async () => {
  let calls = 0;
  const result = await runResearch([entry], {
    fetchPage: pagesFetcher([{ ...storeHome, text: "Plain page with no storefront or US wording at all." }]),
    discoverLinks: () => [],
    extract: async (_n, pages) => { calls++; assert.equal(pages.length, 1); return []; },
  });
  assert.equal(calls, 1);
  assert.equal(result.companies[0].stage, "no_claims");
});

test("maxPagesPerCompany limits fetches", async () => {
  let fetches = 0;
  await runResearch([entry], {
    maxPagesPerCompany: 3,
    fetchPage: async (url) => { fetches++; return { url, title: "t", text: "page text here" }; },
    discoverLinks: (_t, base) => Array.from({ length: 10 }, (_, i) => `${base.replace(/\/$/, "")}/p${i}`),
    extract: async () => [],
  });
  assert.equal(fetches, 3);
});

test("shouldStop leaves unstarted companies in notStarted instead of judging them", async () => {
  let started = 0;
  const entries = ["a", "b", "c", "d"].map((n) => ({
    companyName: n, website: `https://${n}.example/`, extraUrls: [],
  }));

  const result = await runResearch(entries, {
    concurrency: 1,
    shouldStop: () => started >= 2,
    fetchPage: async (url) => { started++; return { url, title: "t", text: "page" }; },
    discoverLinks: () => [],
    extract: async () => [],
  });

  assert.equal(result.companies.length, 2);
  assert.deepEqual(result.notStarted?.map((e) => e.companyName), ["c", "d"]);
});

/* ---------- extractor options ---------- */

const ok = (text: string): AiResponse => ({ text, provider: "gemini", model: "m", attempts: [] });
const longPage: ResearchPage = { url: "https://x.example/", title: "X", text: "A".repeat(25_000) };

test("extractClaims: maxChunksPerPage caps LLM calls on long pages", async () => {
  let calls = 0;
  await extractClaims("X", [longPage], {
    maxChunksPerPage: 1,
    generate: async () => { calls++; return ok('{"claims":[]}'); },
  });
  assert.equal(calls, 1);
});

test("extractClaims: skipMalformedChunks keeps good chunks; default still throws", async () => {
  const good = JSON.stringify({ claims: [{ claim_type: "category", claim: "Sells things", evidence: "A".repeat(30) }] });
  let n = 0;
  const generate = async () => ok(n++ === 0 ? "not json" : good);

  const claims = await extractClaims("X", [longPage], { skipMalformedChunks: true, generate });
  assert.equal(claims.length, 2); // chunks 2 and 3 parsed, chunk 1 skipped

  n = 0;
  await assert.rejects(extractClaims("X", [longPage], { generate }));
});

test("extractClaims: provider outages are never swallowed by skipMalformedChunks", async () => {
  await assert.rejects(
    extractClaims("X", [longPage], {
      skipMalformedChunks: true,
      generate: async () => { throw new AiUnavailableError(["groq: cooling down"]); },
    }),
    AiUnavailableError,
  );
});
