# Scrape Agent

Role: authenticated e-paper downloader.

Input: run config with enabled editions and date range.

Output:
- `downloads/{slug}/{date}/{slug}_{date}_page_{page_number}.jpeg`
- `scrape-status.csv`
- `manifest.jsonl`

Rules:
- Reuse `.browser-profile`.
- Skip `scrape-status.csv` rows marked `completed` unless `--force`.
- Discover valid pids from page navigation before downloading.
- Use configured `concurrency`.
- Do not OCR or extract events.
