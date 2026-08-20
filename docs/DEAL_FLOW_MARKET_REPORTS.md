# AI × Space deal-flow reports

`tools/deal-flow/scraper.ts` is a bounded, public-source collector for early market intelligence. It reads configurable RSS/Atom feeds, keeps only items with AI, space, and deal signals, deduplicates by canonical URL, and writes a JSON evidence record plus a Markdown report.

## Run

```sh
npm run deal-flow:report
```

Useful options:

```sh
npm run deal-flow:report -- --lookback-days 90 --max-items 100
npm run deal-flow:report -- --sources config/deal-flow-sources.json --out-dir reports/market
```

Outputs:

- `reports/market/deal-flow.latest.json` — machine-readable items, source health, scores, and caveats.
- `reports/market/deal-flow.latest.md` — investor-readable market report.

## Evidence contract

- Source pages are public RSS/Atom feeds. The collector does not bypass paywalls, authentication, robots controls, or API limits.
- Response bodies are capped at 1 MiB, requests time out after 10 seconds, sources are capped at 20, and items are capped per source and per report.
- `title`, `url`, `publishedAt`, source identity, and quoted amount text are observed from a source response.
- AI/space/deal labels, stage, amount normalization, and relevance score are inferred and must be validated against primary company or investor announcements.
- Only amounts explicitly expressed in USD are totaled. Currency conversion is intentionally not guessed.
- A blocked or failed source is retained in `sourceResults`; a report is not silently presented as complete.

## Source configuration

Edit `config/deal-flow-sources.json` to add or remove public RSS/Atom sources. Keep sources attributable and prefer primary company, investor, government, exchange, or reputable trade-publication feeds. Do not add private APIs or credentials to the configuration.

The scoring is intentionally deterministic so the report can run offline against saved fixtures and be audited without a model. A future enrichment stage can add human-approved company, investor, geography, and financing validation without changing the raw evidence contract.
