import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverSameSiteLinks,
  fetchResearchPage,
  parseReaderResponse,
} from "../lib/research/pages";

test("parses a Jina Reader response and preserves the original source URL", () => {
  const page = parseReaderResponse(
    [
      "Title: Example About Page",
      "URL Source: https://example.com/about",
      "Markdown Content:",
      "# About Example",
      "Example makes home goods for customers across the United States.",
    ].join("\n"),
    "https://example.com/about#team",
  );

  assert.equal(page.url, "https://example.com/about");
  assert.equal(page.title, "Example About Page");
  assert.match(page.text, /home goods/);
  assert.doesNotMatch(page.text, /URL Source:/);
});

test("uses a fallback title when Reader provides no title", () => {
  const page = parseReaderResponse(
    "Markdown Content:\nPage text with useful content.",
    "https://example.com/our-story",
  );

  assert.equal(page.title, "our story");
  assert.match(page.text, /useful content/);
});

test("rejects an empty Reader response", () => {
  assert.throws(
    () => parseReaderResponse("Title: Empty\nMarkdown Content:\n", "https://example.com"),
    /no page text/,
  );
});

test("discovers same-site links and prioritizes useful pages", () => {
  const markdown = [
    "[Home](https://example.com/)",
    "[Blog](https://example.com/blog)",
    "[About](https://example.com/about)",
    "[Careers](https://example.com/careers)",
    "[External](https://other.example/about)",
    "[PDF](https://example.com/files/report.pdf)",
  ].join("\n");

  const links = discoverSameSiteLinks(markdown, "https://example.com/", 3);

  assert.deepEqual(links, [
    "https://example.com/about",
    "https://example.com/careers",
    "https://example.com/blog",
  ]);
});

test("ignores duplicate links and removes tracking query strings", () => {
  const markdown = [
    "[About](https://example.com/about?utm_source=one)",
    "[About again](https://example.com/about?utm_source=two)",
  ].join("\n");

  const links = discoverSameSiteLinks(markdown, "https://example.com/");

  assert.deepEqual(links, ["https://example.com/about"]);
});

test("rejects non-HTTP and private/local URLs", () => {
  assert.throws(
    () => parseReaderResponse("Some text", "file:///etc/passwd"),
    /Only HTTP and HTTPS/,
  );

  assert.throws(
    () => parseReaderResponse("Some text", "http://localhost/admin"),
    /Private or local/,
  );

  assert.throws(
    () => parseReaderResponse("Some text", "http://192.168.1.10/"),
    /Private or local/,
  );
});

test("fetches through Jina Reader and returns the original page URL", async () => {
  let requestedUrl = "";

  const page = await fetchResearchPage("https://example.com/about", {
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(
        [
          "Title: Example About",
          "URL Source: https://example.com/about",
          "Markdown Content:",
          "Example makes home goods for customers across the United States.",
        ].join("\n"),
        { status: 200 },
      );
    },
  });

  assert.equal(requestedUrl, "https://r.jina.ai/https://example.com/about");
  assert.equal(page.url, "https://example.com/about");
  assert.equal(page.title, "Example About");
});

test("reports Reader HTTP errors clearly", async () => {
  await assert.rejects(
    () =>
      fetchResearchPage("https://example.com", {
        fetch: async () => new Response("Rate limited", { status: 429 }),
      }),
    /HTTP 429/,
  );
});

test("rejects IPv4 and IPv6 address literals as research targets", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
  ]) {
    assert.throws(
      () => parseReaderResponse("Some text", url),
      /IP-address URLs/,
      url,
    );
  }
});

test("rejects local hostnames with a trailing dot", () => {
  assert.throws(
    () => parseReaderResponse("Some text", "http://localhost./"),
    /Private or local/,
  );
});
