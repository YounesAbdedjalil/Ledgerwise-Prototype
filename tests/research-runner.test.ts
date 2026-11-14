import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResearchInput,
  runResearch,
  type ResearchInputEntry,
} from "../lib/research/runner";
import type { ResearchPage } from "../lib/research/verify";

test("parses company names, homepages, and optional same-site pages", () => {
  const entries = parseResearchInput(`
# Example research input
Acme Goods | https://example.com | https://example.com/about
`);

  assert.deepEqual(entries, [
    {
      companyName: "Acme Goods",
      website: "https://example.com/",
      extraUrls: ["https://example.com/about"],
    },
  ]);
});

test("rejects invalid URLs and extra pages from another website", () => {
  assert.throws(
    () => parseResearchInput("Acme | not-a-url"),
    /invalid URL/,
  );

  assert.throws(
    () =>
      parseResearchInput(
        "Acme | https://example.com | https://other.com/about",
      ),
    /same website/,
  );
});

test("rejects empty research input", () => {
  assert.throws(
    () => parseResearchInput("# Only a comment\n\n"),
    /no companies/,
  );
});

test("fetches pages, extracts claims, and accepts only verified evidence", async () => {
  const entries: ResearchInputEntry[] = [
    {
      companyName: "Acme Goods",
      website: "https://example.com/",
      extraUrls: [],
    },
  ];

  const homepage: ResearchPage = {
    url: "https://example.com/",
    title: "Acme Goods",
    text: "Acme Goods sells home goods through its online store.",
  };

  const aboutPage: ResearchPage = {
    url: "https://example.com/about",
    title: "About Acme",
    text: "Acme Goods was founded in 2018 by Jane Doe.",
  };

  const result = await runResearch(entries, {
    fetchPage: async (url) => {
      if (url === "https://example.com/") return homepage;
      if (url === "https://example.com/about") return aboutPage;
      throw new Error(`Unexpected URL: ${url}`);
    },
    discoverLinks: () => ["https://example.com/about"],
    extract: async () => [
      {
        claim_type: "category",
        claim: "Sells home goods",
        source_url: "https://example.com/",
        evidence: "Acme Goods sells home goods through its online store.",
      },
      {
        claim_type: "growth_signal",
        claim: "Recently raised funding",
        source_url: "https://example.com/",
        evidence: "This quotation does not appear on the page.",
      },
    ],
    now: () => new Date("2026-11-13T12:00:00.000Z"),
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].company_name, "Acme Goods");
  assert.equal(result.rows[0].claim_type, "category");
  assert.equal(result.rows[0].retrieved_at, "2026-11-13");

  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].pagesRead.length, 2);
  assert.equal(result.companies[0].proposed, 2);
  assert.equal(result.companies[0].accepted, 1);
  assert.equal(result.companies[0].rejected, 1);
  assert.match(
    result.companies[0].rejectedClaims[0].reason,
    /does not appear/,
  );
});

test("continues to the next company when one homepage cannot be fetched", async () => {
  const entries: ResearchInputEntry[] = [
    {
      companyName: "Unavailable Co",
      website: "https://unavailable.example/",
      extraUrls: [],
    },
    {
      companyName: "Available Co",
      website: "https://available.example/",
      extraUrls: [],
    },
  ];

  const result = await runResearch(entries, {
    fetchPage: async (url) => {
      if (url.includes("unavailable")) {
        throw new Error("Network unavailable");
      }

      return {
        url,
        title: "Available Co",
        text: "Available Co sells products through its online store.",
      };
    },
    discoverLinks: () => [],
    extract: async () => [],
  });

  assert.equal(result.companies.length, 2);
  assert.match(result.companies[0].errors.join(" "), /Network unavailable/);
  assert.equal(result.companies[0].pagesRead.length, 0);
  assert.equal(result.companies[1].pagesRead.length, 1);
});

test("records an extraction failure without losing the company report", async () => {
  const entries: ResearchInputEntry[] = [
    {
      companyName: "Acme",
      website: "https://example.com/",
      extraUrls: [],
    },
  ];

  const result = await runResearch(entries, {
    fetchPage: async (url) => ({
      url,
      title: "Acme",
      text: "Acme sells home goods through its online store.",
    }),
    discoverLinks: () => [],
    extract: async () => {
      throw new Error("AI provider unavailable");
    },
  });

  assert.equal(result.companies.length, 1);
  assert.match(result.companies[0].errors.join(" "), /AI provider unavailable/);
  assert.equal(result.rows.length, 0);
});

test("runResearch rejects unsafe URLs even when input parsing is bypassed", async () => {
  let fetchCalls = 0;

  const result = await runResearch(
    [{
      companyName: "Unsafe Example",
      website: "http://127.0.0.1/",
      extraUrls: [],
    }],
    {
      fetchPage: async (url) => {
        fetchCalls++;
        return {
          url,
          title: "Unexpected",
          text: "This should never be fetched.",
        };
      },
      discoverLinks: () => [],
      extract: async () => [],
    },
  );

  assert.equal(fetchCalls, 0);
  assert.equal(result.companies[0].pagesRead.length, 0);
  assert.match(result.companies[0].errors.join(" "), /IP-address URLs/);
});

test("runResearch rejects extra pages from another hostname", async () => {
  let fetchCalls = 0;

  const result = await runResearch(
    [{
      companyName: "Example",
      website: "https://example.com/",
      extraUrls: ["https://other.example/about"],
    }],
    {
      fetchPage: async (url) => {
        fetchCalls++;
        return {
          url,
          title: "Example",
          text: "Example sells home goods through its online store.",
        };
      },
      discoverLinks: () => [],
      extract: async () => [],
    },
  );

  assert.equal(fetchCalls, 1);
  assert.equal(result.companies[0].pagesRead.length, 1);
  assert.match(result.companies[0].errors.join(" "), /same website/);
});
