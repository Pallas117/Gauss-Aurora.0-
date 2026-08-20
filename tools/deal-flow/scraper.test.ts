import assert from "node:assert/strict";
import test from "node:test";

import { classifyDealFlowItem, parseRssFeed, renderMarkdownReport, scrapeDealFlow, type DealFlowSource } from "./scraper.js";

const source: DealFlowSource = { id: "fixture", name: "Fixture Feed", url: "https://example.test/feed.xml", kind: "rss" };
const feed = `<?xml version="1.0"?><rss><channel>
  <item><title>Orbital AI startup raises $12 million Series A</title><link>https://example.test/deal-1</link><pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate><description><![CDATA[The satellite company uses machine learning inference on spacecraft telemetry.]]></description></item>
  <item><title>AI company announces new model</title><link>https://example.test/not-space</link><pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate><description>Standalone model research.</description></item>
  <item><title>Satellite operator signs launch contract</title><link>https://example.test/not-ai</link><pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate><description>A launch contract for a satellite operator.</description></item>
</channel></rss>`;

test("parseRssFeed extracts bounded RSS item fields", () => {
  const items = parseRssFeed(feed, source, 10);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.title, "Orbital AI startup raises $12 million Series A");
  assert.equal(items[0]?.url, "https://example.test/deal-1");
  assert.equal(items[0]?.publishedAt, "2026-08-19T00:00:00.000Z");
});

test("classifyDealFlowItem requires AI, space, and deal signals", () => {
  const items = parseRssFeed(feed, source, 10);
  const classified = items.map((item) => classifyDealFlowItem(item, source)).filter(Boolean);
  assert.equal(classified.length, 1);
  assert.equal(classified[0]?.amountUsd, 12_000_000);
  assert.equal(classified[0]?.dealStage, "Series A");
  assert.equal(classified[0]?.classificationState, "inferred");
});

test("scrapeDealFlow deduplicates repeated URLs and records source failures", async () => {
  const secondSource: DealFlowSource = { ...source, id: "fixture-2", name: "Fixture Mirror", url: "https://example.test/fixture-2" };
  const fetchImpl: typeof fetch = async (url) => String(url).includes("fixture-2") ? new Response("blocked", { status: 403 }) : new Response(feed, { status: 200 });
  const report = await scrapeDealFlow({ sources: [source, secondSource], now: new Date("2026-08-20T00:00:00.000Z"), lookbackDays: 10, fetchImpl });
  assert.equal(report.items.length, 1);
  assert.deepEqual(report.items[0]?.sourceNames, ["Fixture Feed"]);
  assert.equal(report.sourceResults[1]?.status, "blocked");
  assert.equal(report.stats.observedAmountUsd, 12_000_000);
});

test("renderMarkdownReport labels inferred data and source health", async () => {
  const report = await scrapeDealFlow({ sources: [source], now: new Date("2026-08-20T00:00:00.000Z"), lookbackDays: 10, fetchImpl: async () => new Response(feed, { status: 200 }) });
  const markdown = renderMarkdownReport(report);
  assert.match(markdown, /Gauss AI × Space Deal-Flow Report/);
  assert.match(markdown, /Public-source signal report/i);
  assert.match(markdown, /Fixture Feed/);
});
