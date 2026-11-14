import { isIP } from "node:net";
import type { ResearchPage } from "./verify";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type PageDeps = {
  fetch?: FetchLike;
};

const MAX_PAGE_CHARACTERS = 120_000;

export function validateResearchUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS pages are supported");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  if (isIP(ipHostname) !== 0) {
    throw new Error("Private or local IP-address URLs are not allowed");
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "local"
  ) {
    throw new Error("Private or local URLs are not allowed");
  }

  url.hash = "";
  return url;
}
const safeHttpUrl = validateResearchUrl;
function fallbackTitle(url: URL): string {
  const path = decodeURIComponent(url.pathname)
    .split("/")
    .filter(Boolean)
    .pop();

  return path
    ? path.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "")
    : url.hostname;
}

export function parseReaderResponse(
  responseText: string,
  originalUrl: string,
): ResearchPage {
  const url = safeHttpUrl(originalUrl);
  const lines = responseText.replace(/\r\n/g, "\n").split("\n");

  const titleLine = lines.find((line) => /^Title:\s*/i.test(line));
  const title = titleLine?.replace(/^Title:\s*/i, "").trim();

  const markerIndex = lines.findIndex((line) =>
    /^Markdown Content:\s*$/i.test(line.trim()),
  );

  let contentLines =
    markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines;

  // Remove Jina's metadata headers when the Markdown Content marker is absent.
  if (markerIndex < 0) {
    contentLines = contentLines.filter(
      (line) =>
        !/^(Title|URL Source|Markdown Content):\s*/i.test(line.trim()),
    );
  }

  const text = contentLines.join("\n").trim().slice(0, MAX_PAGE_CHARACTERS);

  if (!text) {
    throw new Error(`Reader returned no page text for ${url.toString()}`);
  }

  return {
    url: url.toString(),
    title: title || fallbackTitle(url),
    text,
  };
}

const USEFUL_PATH = /about|company|our-story|team|leadership|contact|career|jobs|press|news|shipping|wholesale|retail|stockist/i;

export function discoverSameSiteLinks(
  markdown: string,
  baseUrl: string,
  maxLinks = 3,
): string[] {
  const base = safeHttpUrl(baseUrl);
  const found = new Map<string, { url: string; score: number }>();

  const markdownLink = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLink.exec(markdown)) !== null) {
    const raw = match[1];

    try {
      const candidate = new URL(raw, base);

      if (!["http:", "https:"].includes(candidate.protocol)) continue;
      if (candidate.hostname !== base.hostname) continue;
      if (candidate.username || candidate.password) continue;

      candidate.hash = "";
      candidate.search = "";

      // Skip the current page and common non-page assets.
      if (candidate.pathname === base.pathname) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|css|js|zip|xml)$/i.test(candidate.pathname)) {
        continue;
      }

      const normalized = candidate.toString();
      const score = USEFUL_PATH.test(candidate.pathname) ? 1 : 0;

      if (!found.has(normalized)) {
        found.set(normalized, { url: normalized, score });
      }
    } catch {
      // Ignore malformed links; one bad link should not stop page discovery.
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxLinks))
    .map((item) => item.url);
}

export async function fetchResearchPage(
  originalUrl: string,
  deps: PageDeps = {},
): Promise<ResearchPage> {
  const target = safeHttpUrl(originalUrl);
  const fetcher = deps.fetch ?? fetch;
  const readerUrl = `https://r.jina.ai/${target.toString()}`;

  const response = await fetcher(readerUrl, {
    method: "GET",
    headers: {
      Accept: "text/plain",
      "User-Agent": "LedgerwiseResearchPrototype/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Reader request failed for ${target.toString()}: HTTP ${response.status}`,
    );
  }

  const body = await response.text();
  return parseReaderResponse(body, target.toString());
}
