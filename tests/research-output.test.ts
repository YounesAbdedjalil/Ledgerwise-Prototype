import test from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  createResearchCsv,
  createResearchReport,
  RESEARCH_COLUMNS,
} from "../lib/research/output";
import type {
  CompanyResearchReport,
  ResearchOutputRow,
} from "../lib/research/runner";

test("CSV output uses the exact importer columns and preserves values", () => {
  const rows: ResearchOutputRow[] = [
    {
      company_name: "Acme Goods",
      website: "https://example.com/",
      claim_type: "category",
      claim: "Sells home goods",
      source_url: "https://example.com/about",
      source_title: "About Acme",
      retrieved_at: "2026-11-13",
      evidence: 'We sell "home goods" online.',
    },
  ];

  const csv = createResearchCsv(rows);
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true, skipEmptyLines: true,
  });

  assert.deepEqual(parsed.meta.fields, [...RESEARCH_COLUMNS]);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].company_name, "Acme Goods");
  assert.equal(parsed.data[0].evidence, 'We sell "home goods" online.');
});

test("CSV output includes headers when no claims were accepted", () => {
  const csv = createResearchCsv([]);
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true, skipEmptyLines: true,
  });

  assert.deepEqual(parsed.meta.fields, [...RESEARCH_COLUMNS]);
  assert.equal(parsed.data.length, 0);
});

test("report includes totals, sources, rejected claims, and errors", () => {
  const companies: CompanyResearchReport[] = [
    {
      companyName: "Acme Goods",
      website: "https://example.com/",
      pagesRead: ["https://example.com/", "https://example.com/about"],
      proposed: 3,
      accepted: 1,
      rejected: 2,
      errors: ["Could not read https://example.com/jobs: HTTP 500"],
      rejectedClaims: [
        {
          claim_type: "growth_signal",
          reason: "Evidence quote does not appear in the fetched page text",
        },
      ],
    },
  ];

  const report = createResearchReport(companies);

  assert.match(report, /Companies processed: 1/);
  assert.match(report, /Pages read: 2/);
  assert.match(report, /Claims proposed: 3/);
  assert.match(report, /Claims accepted: 1/);
  assert.match(report, /Claims rejected: 2/);
  assert.match(report, /https:\/\/example\.com\/about/);
  assert.match(report, /Evidence quote does not appear/);
  assert.match(report, /HTTP 500/);
  assert.match(report, /Human review is required/);
});
