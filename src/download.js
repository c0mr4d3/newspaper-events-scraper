import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  appendJsonl,
  dateRange,
  ensureDirForFile,
  makePageUrl,
  pageFilePath,
  parseArgs,
  readConfig,
  sleep
} from "./common.js";
import {
  getComboStatus,
  makeCombo,
  upsertComboStatus
} from "./statusCsv.js";

const args = parseArgs(process.argv.slice(2));
const config = await readConfig(args.config);

const profileDir = path.resolve(config.profile_dir || ".browser-profile");
const downloadRoot = path.resolve(config.download_root || "downloads");
const manifestPath = path.resolve(config.manifest_path || "manifest.jsonl");
const statusCsvPath = path.resolve(config.status_csv_path || "scrape-status.csv");
const maxPages = args.maxPages ?? config.max_pages_per_edition_date;
const minimumBytes = config.minimum_file_size_bytes;
const delayMs = Math.max(0, Number(config.delay_between_pages_seconds || 0) * 1000);
const concurrency = Math.max(1, Number(config.concurrency || 1));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: args.headless,
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 }
});

try {
  for (const edition of config.editions.filter((item) => item.enabled)) {
    for (const date of dateRange(config.date_start, config.date_end)) {
      await maybeDownloadEditionDate(context, edition, date);
    }
  }
} finally {
  await context.close();
}

async function maybeDownloadEditionDate(context, edition, date) {
  const combo = makeCombo(config.source || "dainik_bhaskar", edition, date);
  const prior = await getComboStatus(statusCsvPath, combo);

  if (!args.force && !args.dryRun && prior?.status === "completed") {
    console.log(`\n${edition.edition_name || edition.slug} ${date}`);
    console.log(`  skipped: already completed in ${path.relative(process.cwd(), statusCsvPath)}`);
    return;
  }

  const startedAt = new Date().toISOString();
  if (!args.dryRun) {
    await upsertComboStatus(statusCsvPath, {
      ...combo,
      status: "running",
      expected_pages: "",
      saved_pages: "",
      failed_pages: "",
      invalid_pages: "",
      started_at: startedAt,
      finished_at: "",
      output_dir: outputDirFor(edition, date),
      message: args.force && prior?.status === "completed" ? "force rerun" : ""
    });
  }

  const summary = await downloadEditionDate(context, edition, date);
  const status = summarizeComboStatus(summary);
  const message = summarizeMessage(summary);

  if (!args.dryRun) {
    await upsertComboStatus(statusCsvPath, {
      ...combo,
      status,
      expected_pages: summary.expectedPages,
      saved_pages: summary.saved,
      failed_pages: summary.failed,
      invalid_pages: summary.invalid,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      output_dir: outputDirFor(edition, date),
      message
    });
  }
}

async function downloadEditionDate(context, edition, date) {
  console.log(`\n${edition.edition_name || edition.slug} ${date}`);

  const discoveredPids = await discoverAvailablePids(context, edition, date);
  if (discoveredPids.length > 0) {
    const tasks = discoveredPids.slice(0, maxPages).map((pid, index) => ({
      pid,
      pageNumber: index + 1
    }));

    if (!args.force && !args.dryRun && await outputFilesComplete(edition, date, tasks)) {
      console.log(`  skipped: ${tasks.length} existing JPEGs already present`);
      return summarizeResults(tasks.map(() => ({ status: "saved" })), tasks.length);
    }

    console.log(`  discovered ${tasks.length} pages; downloading with concurrency=${Math.min(concurrency, tasks.length)}`);
    return await runTaskPool(context, edition, date, tasks);
  }

  console.log("  could not discover page list; falling back to sequential probing");
  return await runSequentialProbe(context, edition, date);
}

async function discoverAvailablePids(context, edition, date) {
  const page = await context.newPage();
  try {
    const url = makePageUrl(edition, date, 0);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);

    if (!response || response.status() >= 400) return [];
    return await getAvailablePids(page, { edition, date });
  } finally {
    await page.close().catch(() => {});
  }
}

async function runTaskPool(context, edition, date, tasks) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, tasks.length);
  const results = [];

  async function worker(workerIndex) {
    const page = await context.newPage();
    try {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex];
        nextIndex += 1;
        results.push(await processTask(context, page, edition, date, task, workerIndex));
        if (delayMs > 0) await sleep(delayMs);
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
  return summarizeResults(results, tasks.length);
}

async function runSequentialProbe(context, edition, date) {
  let invalidStreak = 0;
  let savedPageCount = 0;

  const page = await context.newPage();
  const results = [];
  try {
    for (let pid = 0; pid < maxPages; pid += 1) {
      const result = await processTask(context, page, edition, date, {
        pid,
        pageNumber: savedPageCount + 1
      }, 1);
      results.push(result);

      if (result.status === "saved" || result.status === "dry-run") {
        invalidStreak = 0;
        savedPageCount += 1;
      } else {
        invalidStreak += 1;
      }

      if (invalidStreak >= config.stop_after_invalid_pages) {
        console.log(`  stopping after ${invalidStreak} consecutive invalid pages`);
        break;
      }

      if (delayMs > 0) await sleep(delayMs);
    }
  } finally {
    await page.close().catch(() => {});
  }

  return summarizeResults(results, savedPageCount);
}

async function processTask(context, page, edition, date, task, workerIndex) {
  const { pid, pageNumber } = task;
  const url = makePageUrl(edition, date, pid);
  const outputPath = pageFilePath(downloadRoot, edition, date, pageNumber);

  try {
    const result = await capturePageImage(context, page, url, outputPath, { edition, date, pid });
    logResult(result, pid, outputPath, workerIndex);
    await writeManifest(edition, date, pid, pageNumber, url, outputPath, result);
    return result;
  } catch (error) {
    const result = { status: "failed", reason: error.message };
    logResult(result, pid, outputPath, workerIndex);
    await writeManifest(edition, date, pid, pageNumber, url, outputPath, result);
    return result;
  }
}

function summarizeResults(results, expectedPages) {
  return {
    expectedPages,
    saved: results.filter((result) => result.status === "saved" || result.status === "dry-run").length,
    failed: results.filter((result) => result.status === "failed").length,
    invalid: results.filter((result) => result.status === "invalid").length,
    results
  };
}

function summarizeComboStatus(summary) {
  if (summary.expectedPages > 0 && summary.saved === summary.expectedPages && summary.failed === 0 && summary.invalid === 0) {
    return "completed";
  }
  if (summary.saved > 0) return "partial";
  return "failed";
}

function summarizeMessage(summary) {
  const failure = summary.results.find((result) => result.status === "failed" || result.status === "invalid");
  if (!failure) return "ok";
  return failure.reason || failure.status;
}

function outputDirFor(edition, date) {
  return path.join(downloadRoot, edition.slug, date);
}

async function outputFilesComplete(edition, date, tasks) {
  for (const task of tasks) {
    const outputPath = pageFilePath(downloadRoot, edition, date, task.pageNumber);
    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat || stat.size < minimumBytes) return false;
  }
  return tasks.length > 0;
}

function logResult(result, pid, outputPath, workerIndex) {
  const prefix = `  [w${workerIndex}]`;
  if (result.status === "saved") {
    console.log(`${prefix} saved pid=${pid} -> ${path.relative(process.cwd(), outputPath)} (${result.bytes} bytes)`);
  } else if (result.status === "dry-run") {
    console.log(`${prefix} dry-run pid=${pid}: ${result.reason} (${result.bytes || 0} bytes)`);
  } else {
    console.log(`${prefix} ${result.status} pid=${pid}: ${result.reason}`);
  }
}

async function writeManifest(edition, date, pid, pageNumber, url, outputPath, result) {
  await appendJsonl(manifestPath, {
    at: new Date().toISOString(),
    edition_slug: edition.slug,
    edition_id: edition.edition_id,
    date,
    pid,
    page_number: pageNumber,
    url,
    output_path: outputPath,
    ...result
  });
}

async function capturePageImage(context, page, url, outputPath, currentPage) {
  page.removeAllListeners("response");
  const imageResponses = [];
  page.on("response", async (response) => {
    const headers = response.headers();
    const contentType = headers["content-type"] || "";
    if (!contentType.startsWith("image/")) return;

    const request = response.request();
    if (request.resourceType() !== "image") return;

    imageResponses.push({
      url: response.url(),
      contentLength: Number(headers["content-length"] || 0),
      contentType
    });
  });

  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);

  const invalidReason = await getInvalidReason(page, response, currentPage);
  if (invalidReason) return { status: "invalid", reason: invalidReason };

  const domCandidates = await getDomImageCandidates(page);
  const renderedImageResult = await saveRenderedDomImageAsJpeg(page, outputPath);
  if (renderedImageResult) {
    if (args.dryRun) return { ...renderedImageResult, status: "dry-run", reason: "would save rendered DOM image as JPEG" };
    return renderedImageResult;
  }

  const candidates = mergeCandidates(domCandidates, imageResponses);
  const directResult = await saveBestDirectImage(context, candidates, outputPath);
  if (directResult) {
    if (args.dryRun) return { ...directResult, status: "dry-run", reason: `would save direct image ${directResult.source_url}` };
    return directResult;
  }

  const downloadResult = await tryDownloadButton(page, outputPath);
  if (downloadResult) {
    if (args.dryRun) return { ...downloadResult, status: "dry-run", reason: "would save via download button" };
    return downloadResult;
  }

  return { status: "invalid", reason: "no usable page image or download button found" };
}

async function getInvalidReason(page, response, currentPage) {
  if (!response) return "navigation produced no response";
  if (response.status() >= 400) return `http ${response.status()}`;

  const text = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).toLowerCase();
  const title = (await page.title().catch(() => "")).toLowerCase();
  const combined = `${title}\n${text}`;

  const invalidPhrases = [
    "page not found",
    "not found",
    "404",
    "something went wrong",
    "no page found",
    "invalid page",
    "edition not found"
  ];

  const largeImageCount = await page.evaluate(() => {
    return Array.from(document.images).filter((img) => {
      const width = img.naturalWidth || img.clientWidth;
      const height = img.naturalHeight || img.clientHeight;
      return width >= 700 && height >= 900;
    }).length;
  }).catch(() => 0);

  if (invalidPhrases.some((phrase) => combined.includes(phrase)) && largeImageCount === 0) {
    return "page looks like a not-found/invalid page";
  }

  const availablePids = await getAvailablePids(page, currentPage);
  if (availablePids.length > 0 && !availablePids.includes(currentPage.pid)) {
    return `pid ${currentPage.pid} is not listed for this edition/date; available pids: ${availablePids.join(",")}`;
  }

  return null;
}

async function getAvailablePids(page, { edition, date }) {
  return page.evaluate(({ slug, editionId, dateValue }) => {
    const pids = new Set();
    const pathNeedle = `/epaper/detail-page/${slug}/${editionId}/${dateValue}`;

    for (const anchor of document.querySelectorAll("a[href]")) {
      if (!anchor.href.includes(pathNeedle)) continue;

      try {
        const url = new URL(anchor.href);
        pids.add(Number(url.searchParams.get("pid") || "0"));
      } catch {
        // Ignore malformed links; valid page navigation links are enough here.
      }
    }

    return Array.from(pids).filter(Number.isInteger).sort((a, b) => a - b);
  }, {
    slug: edition.slug,
    editionId: String(edition.edition_id),
    dateValue: date
  }).catch(() => []);
}

async function saveRenderedDomImageAsJpeg(page, outputPath) {
  const encoded = await page.evaluate(async () => {
    const images = Array.from(document.images)
      .map((img, index) => ({
        index,
        width: img.naturalWidth || img.clientWidth || 0,
        height: img.naturalHeight || img.clientHeight || 0,
        src: img.currentSrc || img.src || ""
      }))
      .filter((img) => img.width >= 700 && img.height >= 900)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));

    const candidate = images[0];
    if (!candidate) return null;

    const sourceImage = document.images[candidate.index];
    const canvas = document.createElement("canvas");
    canvas.width = candidate.width;
    canvas.height = candidate.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(sourceImage, 0, 0, candidate.width, candidate.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    return {
      dataUrl,
      width: candidate.width,
      height: candidate.height,
      sourceUrl: candidate.src
    };
  }).catch(() => null);

  if (!encoded?.dataUrl?.startsWith("data:image/jpeg;base64,")) return null;

  const buffer = Buffer.from(encoded.dataUrl.split(",", 2)[1], "base64");
  if (buffer.length < minimumBytes) return null;

  if (!args.dryRun) {
    await ensureDirForFile(outputPath);
    await fs.writeFile(outputPath, buffer);
  }

  return {
    status: "saved",
    method: "rendered-dom-image",
    source_url: encoded.sourceUrl,
    bytes: buffer.length,
    width: encoded.width,
    height: encoded.height,
    content_type: "image/jpeg"
  };
}

async function getDomImageCandidates(page) {
  return page.evaluate(() => {
    const absolutize = (value) => {
      if (!value) return null;
      try {
        return new URL(value, window.location.href).toString();
      } catch {
        return null;
      }
    };

    return Array.from(document.images)
      .map((img) => {
        const src = absolutize(img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original"));
        const width = img.naturalWidth || img.clientWidth || 0;
        const height = img.naturalHeight || img.clientHeight || 0;
        return {
          url: src,
          width,
          height,
          score: width * height,
          contentType: null,
          source: "dom"
        };
      })
      .filter((item) => item.url && item.width >= 700 && item.height >= 900)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  });
}

function mergeCandidates(domCandidates, networkCandidates) {
  const byUrl = new Map();

  for (const candidate of domCandidates) {
    byUrl.set(candidate.url, candidate);
  }

  for (const candidate of networkCandidates) {
    const existing = byUrl.get(candidate.url) || {};
    byUrl.set(candidate.url, {
      ...existing,
      ...candidate,
      score: Math.max(existing.score || 0, candidate.contentLength || 0),
      source: existing.source ? `${existing.source}+network` : "network"
    });
  }

  return Array.from(byUrl.values())
    .filter((item) => item.url && !isLikelyIcon(item.url))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function isLikelyIcon(url) {
  return /(\blogo\b|sprite|favicon|icon|avatar|placeholder)/i.test(url);
}

async function saveBestDirectImage(context, candidates, outputPath) {
  for (const candidate of candidates.slice(0, 12)) {
    const response = await context.request.get(candidate.url, {
      timeout: 45000,
      headers: {
        referer: "https://www.bhaskar.com/"
      }
    }).catch(() => null);

    if (!response || !response.ok()) continue;
    const buffer = Buffer.from(await response.body());
    if (buffer.length < minimumBytes) continue;

    if (!args.dryRun) {
      await ensureDirForFile(outputPath);
      await fs.writeFile(outputPath, buffer);
    }

    return {
      status: "saved",
      method: "direct-image",
      source_url: candidate.url,
      bytes: buffer.length,
      content_type: response.headers()["content-type"] || candidate.contentType || null
    };
  }

  return null;
}

async function tryDownloadButton(page, outputPath) {
  const selector = [
    "a[download]",
    "button:has-text('Download')",
    "a:has-text('Download')",
    "[aria-label*='download' i]",
    "[title*='download' i]",
    "button:has-text('डाउनलोड')",
    "a:has-text('डाउनलोड')"
  ].join(", ");

  const button = page.locator(selector).first();
  if ((await button.count()) === 0) return null;

  const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await button.click({ timeout: 10000 }).catch(() => {});
  const download = await downloadPromise;
  if (!download) return null;

  const tempPath = await download.path();
  if (!tempPath) return null;

  const stat = await fs.stat(tempPath);
  if (stat.size < minimumBytes) return null;

  if (!args.dryRun) {
    await ensureDirForFile(outputPath);
    await fs.copyFile(tempPath, outputPath);
  }

  return {
    status: "saved",
    method: "download-button",
    source_url: download.url(),
    bytes: stat.size,
    content_type: null
  };
}
