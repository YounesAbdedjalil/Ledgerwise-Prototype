import test from "node:test";
import assert from "node:assert/strict";
import {
  pagesHaveUsEvidence,
  rankPagesByUsEvidence,
  selectEnrichmentPages,
  usEvidenceExcerpt,
  usEvidenceScore,
} from "../lib/research/usSignals";
import { verifyClaims } from "../lib/research/verify";

test("recognises common ways a site states US presence", () => {
  for (const text of [
    "Headquartered in Austin, TX 78701.",
    "We ship across the US with free returns.",
    "Proudly made in the USA.",
    "Free shipping to all 50 states.",
    "Founded in Portland, Oregon by two friends.",
    "Our United States warehouse ships within 2 days.",
    "Domestic shipping is free over $50.",
  ]) {
    assert.ok(usEvidenceScore(text) > 0, text);
  }
});

test("does not mistake the pronoun 'us' in headings for the US", () => {
  for (const text of ["ABOUT US", "CONTACT US", "Join us today", "Write to us at hello@x.com"]) {
    assert.equal(usEvidenceScore(text), 0, text);
  }
  assert.equal(pagesHaveUsEvidence([{ url: "https://x.com/", title: "ABOUT US", text: "Contact us. Follow us." }]), false);
});

test("ranks pages by how much US evidence they carry, ignoring pages with none", () => {
  const pages = [
    { url: "https://x.com/", title: "Home", text: "Nothing relevant" },
    { url: "https://x.com/a", title: "A", text: "Made in the USA." },
    { url: "https://x.com/b", title: "B", text: "Made in the USA. Austin, TX 78701. Ships across the US." },
  ];
  assert.deepEqual(rankPagesByUsEvidence(pages).map((p) => p.url), ["https://x.com/b", "https://x.com/a"]);
});

test("excerpt is small, keeps the evidence, and quotes still verify against the full page", () => {
  const filler = "Lorem ipsum dolor sit amet. ".repeat(2_000);
  const evidence = "Our warehouse is located in Austin, TX 78701 and we ship across the US.";
  const page = { url: "https://x.com/about", title: "About", text: `${filler}${evidence}${filler}` };

  const excerpt = usEvidenceExcerpt(page);
  assert.ok(excerpt.text.length <= 3_000, `${excerpt.text.length}`);
  assert.ok(excerpt.text.includes(evidence));
  assert.equal(excerpt.url, page.url);

  const verified = verifyClaims(
    [{ claim_type: "us_ecommerce", claim: "Ships across the US from Texas", source_url: page.url, evidence }],
    [page],
  );
  assert.equal(verified.accepted.length, 1);
});

test("enrichment prefers about/team/contact pages and never repeats used pages", () => {
  const pages = [
    { url: "https://x.com/", title: "Home", text: "h" },
    { url: "https://x.com/pages/shipping", title: "Ship", text: "s" },
    { url: "https://x.com/pages/about-us", title: "About", text: "a" },
    { url: "https://x.com/pages/contact", title: "Contact", text: "c" },
  ];
  const picked = selectEnrichmentPages(pages, new Set(["https://x.com/pages/about-us"]), 2);
  assert.deepEqual(picked.map((p) => p.url), ["https://x.com/pages/contact", "https://x.com/"]);
  assert.deepEqual(selectEnrichmentPages(pages, new Set(), 0), []);
});
