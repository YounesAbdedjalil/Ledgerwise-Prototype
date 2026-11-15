// Deterministic helpers for the autonomous-discovery "US business presence" gate.
//
// Why this exists: the LLM extractor is the scarcest resource in the pipeline
// (see lib/ai.ts: ~13 calls/min on Gemini's free tier, ~1-2 calls/min on Groq's).
// The extractor prompt only accepts a us_ecommerce claim when the page quotes
// explicit US evidence, so a page set with no US wording at all can never pass
// the gate. Checking that with a regex costs nothing and spares the LLM call.
//
// This is a NECESSARY-condition filter, not a qualification rule: it is
// deliberately broad (false positives just continue to the LLM, which stays the
// authority), so it cannot make the gate looser than the verified-claim check.

import type { ResearchPage } from "./verify";

const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

const STATE_NAMES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming";

// Each entry is one independent kind of evidence. The score of a text is the
// number of kinds that match, which is enough to rank pages.
const US_PATTERNS: RegExp[] = [
  /\bunited states\b/i,
  /\bU\.S\.A?(?![A-Za-z])/i, // "U.S." / "U.S.A"
  /\bUSA\b/, // upper-case only: avoids the pronoun "usa"-like noise
  /\b(?:in|across|within|throughout|to|from|of|all) the US\b/, // case-sensitive on purpose ("ABOUT US" must not match)
  /\bUS[- ](?:based|owned|made|shipping|orders|customers|warehouse|only)\b/,
  /\b(?:made|designed|crafted|handmade|manufactured) in (?:the )?(?:USA|U\.S\.A?\.?|America|United States)\b/i,
  /\bAmerican[- ](?:made|owned|brand|company|small business)\b/i,
  /\ball 50 states\b/i,
  /\bdomestic (?:shipping|orders|delivery)\b/i,
  new RegExp(`,\\s*(?:${STATES})\\s+\\d{5}(?:-\\d{4})?\\b`), // "Austin, TX 78701"
  new RegExp(`\\b[A-Z][A-Za-z.' -]{1,30},\\s*(?:${STATES})\\b(?![a-z])`), // "Austin, TX" (bounded: an open-ended class swallows whole pages)
  new RegExp(`,\\s*(?:${STATE_NAMES})\\b`), // "Austin, Texas"
];

export function usEvidenceScore(text: string): number {
  const normalized = text.normalize("NFKC");
  return US_PATTERNS.reduce((n, p) => n + (p.test(normalized) ? 1 : 0), 0);
}

export function pagesHaveUsEvidence(pages: ResearchPage[]): boolean {
  return pages.some((p) => usEvidenceScore(`${p.title}\n${p.text}`) > 0);
}

/** Pages that contain US wording, strongest first (ties keep fetch order). */
export function rankPagesByUsEvidence(pages: ResearchPage[]): ResearchPage[] {
  return pages
    .map((page, order) => ({
      page,
      order,
      score: usEvidenceScore(`${page.title}\n${page.text}`),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.page);
}

/**
 * A compact copy of a page containing only the neighbourhoods of US-evidence
 * matches. Every sentence in it is an exact substring of the original page, so
 * evidence quoted from it still passes verifyClaims() against the full page,
 * while the LLM call shrinks from ~9k characters to ~3k.
 */
export function usEvidenceExcerpt(
  page: ResearchPage,
  maxChars = 3_000,
  radius = 220,
): ResearchPage {
  const text = page.text;
  const spans: Array<[number, number]> = [];

  for (const pattern of US_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    let hits = 0;
    while ((m = global.exec(text)) !== null && hits < 4) {
      hits++;
      spans.push([Math.max(0, m.index - radius), Math.min(text.length, m.index + m[0].length + radius)]);
      if (m[0].length === 0) global.lastIndex++;
    }
  }

  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }

  let out = "";
  for (const [start, end] of merged) {
    const room = maxChars - out.length - (out ? 1 : 0);
    if (room < 100) break;
    out += (out ? "\n" : "") + text.slice(start, end).slice(0, room);
  }

  return { ...page, text: out || text.slice(0, maxChars) };
}

const ENRICHMENT_PRIORITY: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /about|our-story|who-we-are|company|mission/i, score: 10 },
  { pattern: /team|leadership|founder|management|contact/i, score: 9 },
  { pattern: /press|news|media|careers|jobs/i, score: 8 },
  { pattern: /wholesale|retail|stockist|stores|locations/i, score: 7 },
];

/**
 * Pages worth an enrichment call (contacts, growth and size signals) once a
 * candidate has already passed the US gate. The homepage is always a fallback.
 */
export function selectEnrichmentPages(
  pages: ResearchPage[],
  alreadyUsed: Set<string>,
  limit: number,
): ResearchPage[] {
  if (limit <= 0) return [];

  const scored = pages
    .filter((page) => !alreadyUsed.has(page.url))
    .map((page, order) => {
      let pathname = "/";
      try {
        pathname = new URL(page.url).pathname;
      } catch {
        // keep "/"
      }
      const hit = ENRICHMENT_PRIORITY.find(({ pattern }) => pattern.test(pathname));
      const score = hit ? hit.score : pathname === "/" ? 4 : 0;
      return { page, order, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  return scored.slice(0, limit).map((x) => x.page);
}
