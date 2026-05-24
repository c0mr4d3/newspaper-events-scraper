# Dainik Bhaskar Epaper Downloader

Local Playwright downloader for authenticated Dainik Bhaskar epaper pages.

## Setup

```bash
npm install
cp config.example.json config.json
```

Edit `config.json`, then authenticate once:

```bash
npm run login
```

A normal browser window opens with a persistent profile stored in `.browser-profile/`. Log in to Bhaskar there, visit any paid epaper page if needed, then press Enter in the terminal to close the browser.

Run the downloader:

```bash
npm run scrape -- --config config.json
```

The default download mode is headed because Bhaskar currently returns `403` to Playwright's headless Chromium in this environment. You can still try headless with:

```bash
npm run download:headless -- --config config.json
```

Useful debug run:

```bash
npm run debug -- --config config.json
```

## Output

Files are saved as:

```text
downloads/{slug}/{date}/{slug}_{date}_page_{page_number}.jpeg
```

`manifest.jsonl` records every saved, skipped, invalid, and failed page so interrupted runs are easier to inspect.

`scrape-status.csv` records one row per `source + slug + edition_id + date` combination. Reruns skip rows marked `completed`; use `--force` when you intentionally want to scrape a completed combination again.

Tune speed with `concurrency` and `delay_between_pages_seconds` in `config.json`. The downloader reuses a fixed number of tabs equal to `concurrency`.

## Resume Behavior

```bash
npm run scrape -- --config config.json
```

The script runs all enabled editions for every date in `date_start..date_end`. Each combo is marked `running`, then `completed`, `partial`, or `failed` in `scrape-status.csv`.

Force a rerun of completed combos:

```bash
npm run scrape -- --config config.json --force
```

## Agent Runner

Use the orchestrator when you want to issue a city/date job and let stage agents run in order:

```bash
npm run run-job -- --city Raipur --date-start 2026-05-13 --date-end 2026-05-13
```

The orchestrator writes a per-run config and status under:

```text
runs/{run_id}/
```

It runs:

```text
scrape-agent -> ocr-agent -> event-extraction-agent
```

Agent specs live in:

```text
agents/
```

You can target a specific edition instead:

```bash
npm run run-job -- --slug raipur --edition-id 116 --date-start 2026-05-13 --date-end 2026-05-20
```

## Event Leads

OCR downloaded pages and extract possible trophy/memento/corporate-gifting event leads:

```bash
npm run leads -- --config config.json
```

This writes:

```text
event_leads.csv
```

with exactly:

```text
city,date,org_name,event_topic
```

OCR text is cached under `ocr/{slug}/{date}/`. Use `--force` to OCR pages again:

```bash
npm run leads -- --config config.json --force
```

## Notes

- `pid` starts at `0`; output page numbering starts at `001` by default.
- The downloader first discovers valid pids from the edition's page navigation. If that fails, it falls back to sequential probing and stops after `stop_after_invalid_pages` consecutive invalid pages.
- The scraper first tries to extract the rendered large DOM image and encode it as JPEG. If that fails, it tries direct image responses, then a likely download control.
