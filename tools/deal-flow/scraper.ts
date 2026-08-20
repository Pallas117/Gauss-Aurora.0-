import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readResponseTextBounded } from "../../backend/runtime/bounded-response.js";

export type TruthState = "observed" | "inferred" | "unknown" | "blocked";

export interface DealFlowSource {
  id: string;
  name: string;
  url: string;
  kind: "rss";
}

export interface SourceResult {
  source: DealFlowSource;
  status: "ok" | "failed" | "blocked";
  fetchedAt: string;
  itemCount: number;
  error?: string;
}

export interface DealFlowItem {
  id: string;
  title: string;
  url: string;
  sourceIds: string[];
  sourceNames: string[];
  publishedAt: string | null;
  summary: string;
  amountText: string | null;
  amountUsd: number | null;
  dealStage: string | null;
  spaceSignals: string[];
  aiSignals: string[];
  dealSignals: string[];
  relevanceScore: number;
  classificationState: "inferred";
  evidence: string[];
}

export interface DealFlowReport {
  reportType: "gauss-ai-space-deal-flow-v1";
  generatedAt: string;
  lookbackDays: number;
  truthState: TruthState;
  sourceResults: SourceResult[];
  items: DealFlowItem[];
  stats: {
    sourceCount: number;
    successfulSources: number;
    failedSources: number;
    relevantItems: number;
    itemsWithObservedAmount: number;
    observedAmountUsd: number;
    stageCounts: Record<string, number>;
  };
  caveats: string[];
}

export interface ScrapeOptions {
  sources: DealFlowSource[];
  lookbackDays?: number;
  maxItemsPerSource?: number;
  maxTotalItems?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
}

const DEFAULT_LOOKBACK_DAYS = 120;
const DEFAULT_MAX_ITEMS_PER_SOURCE = 40;
const DEFAULT_MAX_TOTAL_ITEMS = 150;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 1 * 1024 * 1024;

const SPACE_TERMS = [
  "space", "satellite", "spacecraft", "orbital", "orbit", "launch", "rocket",
  "earth observation", "geospatial", "space weather", "ground station", "constellation", "in-orbit", "ssa",
];
const AI_TERMS = [
  "artificial intelligence", "machine learning", "\\bai\\b", "large language model", "llm",
  "foundation model", "gpu", "inference", "computer vision", "autonomous", "robotics",
];
const DEAL_TERMS = [
  "raised", "funding", "financing", "investment", "investor", "seed round", "series a", "series b", "series c",
  "grant", "contract", "acquisition", "acquires", "partnership",
];
const STAGE_PATTERNS: Array<[string, RegExp]> = [
  ["Series C+", /series\s+[c-z]/i], ["Series B", /series\s+b/i], ["Series A", /series\s+a/i],
  ["Seed", /\bseed\b|pre-seed/i], ["Grant", /\bgrant\b/i], ["Contract", /\bcontract\b|purchase order/i],
  ["Acquisition", /\bacqui(?:re|red|res|sition)\b/i],
];

function normalizeWhitespace(value: string): string { return value.replace(/\s+/g, " ").trim(); }

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}

function stripMarkup(value: string): string { return normalizeWhitespace(decodeXml(value).replace(/<[^>]+>/g, " ")); }

function firstTag(value: string, names: string[]): string | null {
  for (const name of names) {
    const match = value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match?.[1]) return stripMarkup(match[1]);
  }
  return null;
}

function firstLink(value: string): string | null {
  const atom = value.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i);
  return atom?.[1] ? decodeXml(atom[1]).trim() : firstTag(value, ["link", "guid", "id"]);
}

function canonicalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function termMatches(text: string, terms: string[]): string[] {
  const normalized = text.toLowerCase();
  return terms.filter((term) => term.startsWith("\\b") ? new RegExp(term, "i").test(normalized) : normalized.includes(term));
}

function parseAmount(text: string): { amountText: string | null; amountUsd: number | null } {
  const match = text.match(/\$\s?([0-9]+(?:\.[0-9]+)?)\s?(million|billion|m|bn|b)?/i);
  if (!match) return { amountText: null, amountUsd: null };
  const multiplier = /billion|bn|b/i.test(match[2] ?? "") ? 1_000_000_000 : /million|m/i.test(match[2] ?? "") ? 1_000_000 : 1;
  const amountUsd = Number(match[1]) * multiplier;
  return { amountText: match[0].replace(/\s+/g, " ").trim(), amountUsd: Number.isFinite(amountUsd) ? amountUsd : null };
}

function inferStage(text: string): string | null { return STAGE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null; }

export function parseRssFeed(xml: string, _source: DealFlowSource, maxItems = DEFAULT_MAX_ITEMS_PER_SOURCE): Array<{
  title: string; url: string; publishedAt: string | null; summary: string;
}> {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, Math.max(1, Math.floor(maxItems)));
  const items: Array<{ title: string; url: string; publishedAt: string | null; summary: string }> = [];
  for (const block of blocks) {
    const raw = block[2] ?? "";
    const title = firstTag(raw, ["title"]);
    const url = canonicalUrl(firstLink(raw));
    if (!title || !url) continue;
    items.push({
      title: normalizeWhitespace(title), url,
      publishedAt: parseDate(firstTag(raw, ["pubDate", "published", "updated", "date"])),
      summary: normalizeWhitespace(firstTag(raw, ["description", "summary", "content:encoded", "content"]) ?? ""),
    });
  }
  return items;
}

export function classifyDealFlowItem(
  item: { title: string; url: string; publishedAt: string | null; summary: string }, source: DealFlowSource,
): DealFlowItem | null {
  const text = `${item.title} ${item.summary}`;
  const spaceSignals = termMatches(text, SPACE_TERMS);
  const aiSignals = termMatches(text, AI_TERMS);
  const dealSignals = termMatches(text, DEAL_TERMS);
  if (spaceSignals.length === 0 || aiSignals.length === 0 || dealSignals.length === 0) return null;
  const amount = parseAmount(text);
  const relevanceScore = Math.round(
    Math.min(1, spaceSignals.length / 3) * 40 + Math.min(1, aiSignals.length / 3) * 40 + Math.min(1, dealSignals.length / 2) * 20,
  );
  return {
    id: `${source.id}:${item.url}`, title: item.title, url: item.url, sourceIds: [source.id], sourceNames: [source.name],
    publishedAt: item.publishedAt, summary: item.summary.slice(0, 700), amountText: amount.amountText, amountUsd: amount.amountUsd,
    dealStage: inferStage(text), spaceSignals, aiSignals, dealSignals, relevanceScore, classificationState: "inferred",
    evidence: [source.url, item.url, `Keyword classification from ${source.name} feed content.`],
  };
}

function mergeItems(items: DealFlowItem[]): DealFlowItem[] {
  const byUrl = new Map<string, DealFlowItem>();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing) { byUrl.set(item.url, { ...item }); continue; }
    existing.sourceIds = [...new Set([...existing.sourceIds, ...item.sourceIds])];
    existing.sourceNames = [...new Set([...existing.sourceNames, ...item.sourceNames])];
    existing.spaceSignals = [...new Set([...existing.spaceSignals, ...item.spaceSignals])];
    existing.aiSignals = [...new Set([...existing.aiSignals, ...item.aiSignals])];
    existing.dealSignals = [...new Set([...existing.dealSignals, ...item.dealSignals])];
    existing.evidence = [...new Set([...existing.evidence, ...item.evidence])];
    existing.relevanceScore = Math.max(existing.relevanceScore, item.relevanceScore);
  }
  return [...byUrl.values()].sort((a, b) => b.relevanceScore - a.relevanceScore || a.title.localeCompare(b.title));
}

function withinLookback(publishedAt: string | null, now: Date, lookbackDays: number): boolean {
  if (!publishedAt) return true;
  const ageMs = now.getTime() - Date.parse(publishedAt);
  return ageMs >= -86_400_000 && ageMs <= lookbackDays * 86_400_000;
}

export async function scrapeDealFlow(options: ScrapeOptions): Promise<DealFlowReport> {
  const now = options.now ?? new Date();
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS));
  const maxItemsPerSource = Math.max(1, Math.floor(options.maxItemsPerSource ?? DEFAULT_MAX_ITEMS_PER_SOURCE));
  const maxTotalItems = Math.max(1, Math.floor(options.maxTotalItems ?? DEFAULT_MAX_TOTAL_ITEMS));
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const fetchImpl = options.fetchImpl ?? fetch;
  const items: DealFlowItem[] = [];
  const sourceResults: SourceResult[] = [];
  for (const source of options.sources.slice(0, 20)) {
    const fetchedAt = new Date().toISOString();
    try {
      const response = await fetchImpl(source.url, {
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8", "user-agent": "GaussAuroraDealFlow/1.0 (public-read-only)" },
        redirect: "follow", signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        sourceResults.push({ source, status: "blocked", fetchedAt, itemCount: 0, error: `HTTP ${response.status}` }); continue;
      }
      if (!response.ok) { sourceResults.push({ source, status: "failed", fetchedAt, itemCount: 0, error: `HTTP ${response.status}` }); continue; }
      const body = await readResponseTextBounded(response, MAX_FEED_BYTES);
      if (body === null) { sourceResults.push({ source, status: "failed", fetchedAt, itemCount: 0, error: "Feed exceeded 1 MiB response budget." }); continue; }
      const parsed = parseRssFeed(body, source, maxItemsPerSource);
      let relevantCount = 0;
      for (const item of parsed) {
        if (!withinLookback(item.publishedAt, now, lookbackDays)) continue;
        const classified = classifyDealFlowItem(item, source);
        if (classified) { items.push(classified); relevantCount += 1; }
      }
      sourceResults.push({ source, status: "ok", fetchedAt, itemCount: relevantCount });
    } catch (error) {
      sourceResults.push({ source, status: "failed", fetchedAt, itemCount: 0, error: error instanceof Error ? error.message.slice(0, 240) : "Unknown fetch failure" });
    }
  }
  const mergedItems = mergeItems(items).slice(0, maxTotalItems);
  const stageCounts: Record<string, number> = {};
  for (const item of mergedItems) { const stage = item.dealStage ?? "Unclassified deal signal"; stageCounts[stage] = (stageCounts[stage] ?? 0) + 1; }
  const observedAmountUsd = mergedItems.reduce((sum, item) => sum + (item.amountUsd ?? 0), 0);
  const failedSources = sourceResults.filter((result) => result.status !== "ok").length;
  return {
    reportType: "gauss-ai-space-deal-flow-v1", generatedAt: now.toISOString(), lookbackDays,
    truthState: failedSources === sourceResults.length && sourceResults.length > 0 ? "blocked" : "observed",
    sourceResults, items: mergedItems,
    stats: {
      sourceCount: sourceResults.length, successfulSources: sourceResults.filter((result) => result.status === "ok").length,
      failedSources, relevantItems: mergedItems.length, itemsWithObservedAmount: mergedItems.filter((item) => item.amountUsd !== null).length,
      observedAmountUsd, stageCounts,
    },
    caveats: [
      "This is a public-feed signal collector, not a verified financing database.",
      "Keyword scores and deal stages are inferred; validate material claims against primary company or investor announcements.",
      "Missing, delayed, paywalled, duplicated, or blocked sources can make this report incomplete.",
      "Currency conversion is intentionally not inferred; only amounts explicitly expressed in USD are totaled.",
    ],
  };
}

export function renderMarkdownReport(report: DealFlowReport): string {
  const lines = [
    "# Gauss AI × Space Deal-Flow Report", "", `Generated: ${report.generatedAt}`,
    `Lookback: ${report.lookbackDays} days · Truth state: **${report.truthState}**`, "",
    "> Public-source signal report. Amounts, stages, and relevance classifications require primary-source validation before investment use.", "",
    "## Executive signal", "", `- ${report.stats.relevantItems} relevant deal signals across ${report.stats.successfulSources}/${report.stats.sourceCount} successful sources.`,
    `- ${report.stats.itemsWithObservedAmount} items contain an explicitly observed USD amount; total observed USD amount: ${formatUsd(report.stats.observedAmountUsd)}.`,
    `- Highest-volume stages: ${Object.entries(report.stats.stageCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([stage, count]) => `${stage} (${count})`).join(", ") || "none"}.`,
    "", "## Deal signals", "", "| Score | Deal stage | Amount | Company/news signal | Sources |", "| ---: | --- | ---: | --- | --- |",
  ];
  for (const item of report.items.slice(0, 30)) lines.push(`| ${item.relevanceScore} | ${item.dealStage ?? "Unclassified"} | ${item.amountText ?? "—"} | [${escapeMarkdown(item.title)}](${item.url}) | ${item.sourceNames.join(", ")} |`);
  if (report.items.length === 0) lines.push("| — | — | — | No relevant deal signals observed in the lookback window. | — |");
  lines.push("", "## Source health", "", "| Source | Status | Relevant items | Error |", "| --- | --- | ---: | --- |");
  for (const result of report.sourceResults) lines.push(`| ${result.source.name} | ${result.status} | ${result.itemCount} | ${result.error ?? "—"} |`);
  lines.push("", "## Caveats", "", ...report.caveats.map((caveat) => `- ${caveat}`), "");
  return lines.join("\n");
}

function formatUsd(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function escapeMarkdown(value: string): string { return value.replace(/[|\n]/g, " "); }
function argValue(flag: string): string | null { const index = process.argv.indexOf(flag); const value = index >= 0 ? process.argv[index + 1] : null; return value && !value.startsWith("--") ? value : null; }
function loadSources(configPath: string): DealFlowSource[] { const parsed = JSON.parse(readFileSync(configPath, "utf8")) as DealFlowSource[]; return parsed.filter((source) => source && source.kind === "rss" && typeof source.url === "string"); }

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const configPath = path.resolve(root, argValue("--sources") ?? "config/deal-flow-sources.json");
  const outputDir = path.resolve(root, argValue("--out-dir") ?? "reports/market");
  const report = await scrapeDealFlow({ sources: loadSources(configPath), lookbackDays: Number(argValue("--lookback-days") ?? DEFAULT_LOOKBACK_DAYS), maxItemsPerSource: Number(argValue("--max-items-per-source") ?? DEFAULT_MAX_ITEMS_PER_SOURCE), maxTotalItems: Number(argValue("--max-items") ?? DEFAULT_MAX_TOTAL_ITEMS) });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "deal-flow.latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outputDir, "deal-flow.latest.md"), renderMarkdownReport(report), "utf8");
  console.log(JSON.stringify({ outputDir, stats: report.stats, truthState: report.truthState }, null, 2));
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
