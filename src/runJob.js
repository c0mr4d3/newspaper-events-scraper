import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { readConfig } from "./common.js";

const args = parseRunArgs(process.argv.slice(2));
const baseConfigPath = args.config || "config.json";
const baseConfig = await readConfig(baseConfigPath);
const runId = args.runId || makeRunId(args);
const runDir = path.resolve("runs", runId);
const runConfigPath = path.join(runDir, "config.json");
const statusPath = path.join(runDir, "status.json");

const runConfig = buildRunConfig(baseConfig, args);
await fs.mkdir(runDir, { recursive: true });
await fs.writeFile(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);

await writeStatus("created", "run config written");

try {
  await runStage("scrape", "src/download.js", ["--config", runConfigPath]);
  await runStage("ocr", "src/ocr.js", ["--config", runConfigPath]);
  await runStage("extract-events", "src/extractEvents.js", ["--config", runConfigPath]);
  await writeStatus("completed", "all stage agents completed");
  console.log(`\nJob completed: ${runId}`);
  console.log(`Status: ${path.relative(process.cwd(), statusPath)}`);
  console.log(`Leads: ${runConfig.event_leads_path || "event_leads.csv"}`);
} catch (error) {
  await writeStatus("failed", error.message);
  throw error;
}

function parseRunArgs(argv) {
  const parsed = {
    config: "config.json",
    force: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") parsed.config = argv[++i];
    else if (arg === "--city") parsed.city = argv[++i];
    else if (arg === "--slug") parsed.slug = argv[++i];
    else if (arg === "--edition-id") parsed.editionId = Number(argv[++i]);
    else if (arg === "--date-start") parsed.dateStart = argv[++i];
    else if (arg === "--date-end") parsed.dateEnd = argv[++i];
    else if (arg === "--run-id") parsed.runId = argv[++i];
    else if (arg === "--force") parsed.force = true;
    else throw new Error(`Unknown run-job argument: ${arg}`);
  }

  if (!parsed.dateStart || !parsed.dateEnd) {
    throw new Error("run-job requires --date-start YYYY-MM-DD and --date-end YYYY-MM-DD");
  }
  if (!parsed.city && !parsed.slug && !parsed.editionId) {
    throw new Error("run-job requires at least one selector: --city, --slug, or --edition-id");
  }

  return parsed;
}

function buildRunConfig(baseConfig, selectors) {
  const editions = baseConfig.editions.map((edition) => ({
    ...edition,
    enabled: matchesEdition(edition, selectors)
  }));

  const enabled = editions.filter((edition) => edition.enabled);
  if (enabled.length === 0) {
    throw new Error("No editions matched the requested city/slug/edition-id");
  }

  return {
    ...baseConfig,
    date_start: selectors.dateStart,
    date_end: selectors.dateEnd,
    editions
  };
}

function matchesEdition(edition, selectors) {
  if (selectors.city && normalize(edition.city) !== normalize(selectors.city)) return false;
  if (selectors.slug && edition.slug !== selectors.slug) return false;
  if (selectors.editionId && Number(edition.edition_id) !== selectors.editionId) return false;
  if (!selectors.slug && !selectors.editionId && edition.enabled === false) return false;
  return true;
}

async function runStage(name, script, scriptArgs) {
  await writeStatus("running", `running ${name}`, name);
  console.log(`\n[orchestrator] starting ${name}`);
  const finalArgs = args.force ? [...scriptArgs, "--force"] : scriptArgs;

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...finalArgs], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} failed with exit code ${code}`));
    });
  });

  await writeStatus("running", `${name} completed`, name);
}

async function writeStatus(status, message, currentStage = null) {
  const payload = {
    run_id: runId,
    status,
    current_stage: currentStage,
    message,
    city: args.city || null,
    slug: args.slug || null,
    edition_id: args.editionId || null,
    date_start: args.dateStart,
    date_end: args.dateEnd,
    force: args.force,
    run_config: runConfigPath,
    updated_at: new Date().toISOString()
  };
  await fs.writeFile(statusPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function makeRunId({ city, slug, editionId, dateStart, dateEnd }) {
  const target = slug || city || `edition-${editionId}`;
  return `${safeId(target)}_${dateStart}_${dateEnd}_${Date.now()}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function safeId(value) {
  return normalize(value).replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}
