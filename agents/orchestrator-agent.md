# Orchestrator Agent

Role: manager for newspaper lead extraction jobs.

Input: city/edition/date range from Siddharth.

Responsibilities:
- Build a narrow run config from `config.json`.
- Run stage agents sequentially: scrape, OCR, extract.
- Do not manually inspect or curate leads unless asked.
- Track job state in `runs/{run_id}/status.json`.
- Let stage-level resume files skip already completed work.

Default command:

```bash
npm run run-job -- --city Raipur --date-start 2026-05-13 --date-end 2026-05-13
```

Force rerun:

```bash
npm run run-job -- --city Raipur --date-start 2026-05-13 --date-end 2026-05-13 --force
```
