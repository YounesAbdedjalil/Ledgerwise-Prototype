import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fetchResearchPage } from "../lib/research/pages";
import { parseResearchInput, runResearch } from "../lib/research/runner";
import {
  createResearchCsv,
  createResearchReport,
} from "../lib/research/output";

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "docs/research-input.txt");
const OUTPUT_DIR = path.join(ROOT, "docs/research-output");
const CACHE_DIR = path.join(ROOT, ".cache/pages");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedPage = {
  fetchedAt: number;
  page: {
    url: string;
    title: string;
    text: string;
  };
};

function cachePath(url: string): string {
  const key = createHash("sha256").update(url).digest("hex");
  return path.join(CACHE_DIR, `${key}.json`);
}

async function fetchWithCache(url: string) {
  const filePath = cachePath(url);

  try {
    const raw = await readFile(filePath, "utf8");
    const cached = JSON.parse(raw) as CachedPage;

    const valid =
      cached &&
      Number.isFinite(cached.fetchedAt) &&
      cached.page &&
      cached.page.url === url &&
      typeof cached.page.title === "string" &&
      typeof cached.page.text === "string" &&
      cached.page.text.length > 0;

    const cacheAge = valid ? Date.now() - cached.fetchedAt : -1;

    if (valid && cacheAge >= 0 && cacheAge < CACHE_TTL_MS) {
      console.log(`  Cache hit: ${url}`);
      return cached.page;
    }
  } catch {
    // Missing or invalid cache: fetch a fresh copy.
  }

  console.log(`  Fetching: ${url}`);
  const page = await fetchResearchPage(url);

  await mkdir(CACHE_DIR, { recursive: true });
  const cached: CachedPage = {
    fetchedAt: Date.now(),
    page,
  };

  await writeFile(filePath, JSON.stringify(cached, null, 2), "utf8");
  return page;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const input = await readFile(INPUT_PATH, "utf8");
  const entries = parseResearchInput(input);

  console.log(`Starting research for ${entries.length} companies.`);
  console.log("A maximum of three discovered pages per homepage will be added.");
  console.log("");

  const result = await runResearch(entries, {
    fetchPage: fetchWithCache,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(OUTPUT_DIR, `research-${timestamp}.csv`);
  const reportPath = path.join(OUTPUT_DIR, `research-${timestamp}-report.md`);

  await writeFile(csvPath, createResearchCsv(result.rows), "utf8");
  await writeFile(reportPath, createResearchReport(result.companies), "utf8");

  const failedCompanies = result.companies.filter(
    (company) => company.errors.length > 0,
  ).length;

  console.log("");
  console.log("Research run finished.");
  console.log(`Companies processed: ${result.companies.length}`);
  console.log(`Claims accepted: ${result.rows.length}`);
  console.log(`Companies with errors: ${failedCompanies}`);
  console.log(`CSV: ${path.relative(ROOT, csvPath)}`);
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  console.log("");
  console.log("IMPORTANT: Review every accepted CSV row against its source before importing.");
}

main().catch((error: unknown) => {
  console.error(
    "Research run failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
