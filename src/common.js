import fs from "node:fs/promises";
import path from "node:path";

export function parseArgs(argv) {
  const args = {
    config: "config.json",
    headed: true,
    headless: false,
    dryRun: false,
    force: false,
    maxPages: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--headless") {
      args.headless = true;
      args.headed = false;
    }
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--max-pages") args.maxPages = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export async function readConfig(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = [
    "date_start",
    "date_end",
    "max_pages_per_edition_date",
    "stop_after_invalid_pages",
    "minimum_file_size_bytes",
    "delay_between_pages_seconds",
    "editions"
  ];

  for (const key of required) {
    if (config[key] === undefined) throw new Error(`Missing config key: ${key}`);
  }

  if (!Array.isArray(config.editions)) throw new Error("config.editions must be an array");
  for (const edition of config.editions) {
    for (const key of ["slug", "edition_id", "enabled"]) {
      if (edition[key] === undefined) throw new Error(`Edition is missing key: ${key}`);
    }
  }
}

export function* dateRange(startDate, endDate) {
  const current = parseDate(startDate);
  const end = parseDate(endDate);
  if (current > end) throw new Error("date_start must be before or equal to date_end");

  while (current <= end) {
    yield toDateString(current);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${value}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function makePageUrl(edition, date, pid) {
  return `https://www.bhaskar.com/epaper/detail-page/${edition.slug}/${edition.edition_id}/${date}?pid=${pid}`;
}

export function pageFilePath(downloadRoot, edition, date, pageNumber) {
  const padded = String(pageNumber).padStart(3, "0");
  return path.join(downloadRoot, edition.slug, date, `${edition.slug}_${date}_page_${padded}.jpeg`);
}

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function appendJsonl(filePath, record) {
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`);
}
