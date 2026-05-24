import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { dateRange, parseArgs, readConfig } from "./common.js";

const args = parseArgs(process.argv.slice(2));
const config = await readConfig(args.config);
const downloadRoot = path.resolve(config.download_root || "downloads");
const ocrRoot = path.resolve(config.ocr_root || "ocr");
const concurrency = Math.max(1, Number(config.ocr_concurrency || 4));

const tasks = [];
for (const edition of config.editions.filter((item) => item.enabled)) {
  for (const date of dateRange(config.date_start, config.date_end)) {
    const dir = path.join(downloadRoot, edition.slug, date);
    const files = await fs.readdir(dir).catch(() => []);
    for (const file of files.filter((name) => name.toLowerCase().endsWith(".jpeg")).sort()) {
      const imagePath = path.join(dir, file);
      const outPath = path.join(ocrRoot, edition.slug, date, file.replace(/\.jpe?g$/i, ".txt"));
      tasks.push({ imagePath, outPath });
    }
  }
}

if (tasks.length === 0) {
  console.log("No downloaded JPEGs found for enabled config combinations.");
  process.exit(0);
}

let nextIndex = 0;
let completed = 0;

async function worker(workerIndex) {
  while (nextIndex < tasks.length) {
    const task = tasks[nextIndex];
    nextIndex += 1;

    const existing = await fs.stat(task.outPath).catch(() => null);
    if (existing?.size > 0 && !args.force) {
      completed += 1;
      console.log(`[ocr w${workerIndex}] skip ${path.relative(process.cwd(), task.outPath)}`);
      continue;
    }

    await fs.mkdir(path.dirname(task.outPath), { recursive: true });
    const text = await runTesseract(task.imagePath);
    await fs.writeFile(task.outPath, text);
    completed += 1;
    console.log(`[ocr w${workerIndex}] ${completed}/${tasks.length} ${path.relative(process.cwd(), task.outPath)}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, (_, index) => worker(index + 1)));

function runTesseract(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", [
      imagePath,
      "stdout",
      "-l",
      config.ocr_lang || "hin+eng",
      "--psm",
      String(config.ocr_psm || 6),
      "--dpi",
      String(config.ocr_dpi || 300)
    ]);

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`tesseract failed for ${imagePath}: ${stderr.trim()}`));
    });
  });
}
