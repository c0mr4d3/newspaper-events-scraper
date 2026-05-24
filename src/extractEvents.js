import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { dateRange, parseArgs, readConfig } from "./common.js";

const args = parseArgs(process.argv.slice(2));
const config = await readConfig(args.config);
const ocrRoot = path.resolve(config.ocr_root || "ocr");
const outputPath = path.resolve(config.event_leads_path || "event_leads.csv");

const EVENT_PATTERNS = [
  "सम्मान समारोह", "पुरस्कार वितरण", "प्रतिभा सम्मान", "मेधावी छात्र सम्मान",
  "वार्षिकोत्सव", "स्थापना दिवस", "डीलर मीट", "वितरक सम्मेलन",
  "कर्मचारी सम्मान", "शिक्षक सम्मान", "विदाई समारोह", "सेवानिवृत्ति",
  "शपथ ग्रहण समारोह", "सांस्कृतिक कार्यक्रम", "खेल प्रतियोगिता",
  "कार्यक्रम", "आयोजन", "समारोह", "सम्मेलन", "संगोष्ठी", "कार्यशाला",
  "जयंती", "विदाई", "स्वागत", "उद्घाटन", "प्रतियोगिता", "सम्मान",
  "सम्मानित", "पुरस्कार", "पुरस्कृत", "ट्रॉफी", "शील्ड", "स्मृति चिन्ह",
  "प्रतीक चिन्ह", "मोमेंटो", "मेडल", "प्रशस्ति पत्र", "सम्मान पत्र",
  "मेधावी छात्र", "उत्कृष्ट प्रदर्शन", "विजेता", "उपविजेता"
];

const ORG_CLUES = [
  "बैंक", "स्कूल", "विद्यालय", "महाविद्यालय", "कॉलेज", "विश्वविद्यालय",
  "संस्था", "समिति", "समाज", "संघ", "एसोसिएशन", "मंडल", "क्लब",
  "ट्रस्ट", "फाउंडेशन", "कंपनी", "उद्योग", "फैक्ट्री", "प्लांट",
  "विभाग", "कार्यालय", "निगम", "परिषद", "चेंबर", "संगठन",
  "व्यापारी संघ", "उद्योग संघ", "रोटरी क्लब", "लायंस क्लब", "जेसीआई"
];

const IGNORE_PATTERNS = [
  "हत्या", "दुर्घटना", "मौत", "शव", "अपराध", "चोरी", "लूट", "पुलिस",
  "कोर्ट", "अदालत", "मुकदमा", "आरोप", "विरोध", "धरना", "प्रदर्शन",
  "मौसम", "बारिश", "शिकायत"
];

const rows = [];
const seen = new Set();

for (const edition of config.editions.filter((item) => item.enabled)) {
  for (const newspaperDate of dateRange(config.date_start, config.date_end)) {
    const city = edition.city || titleCaseSlug(edition.slug);
    const dir = path.join(ocrRoot, edition.slug, newspaperDate);
    const files = (await fs.readdir(dir).catch(() => [])).filter((name) => name.endsWith(".txt")).sort();

    for (const file of files) {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      for (const lead of extractLeads(text, city, newspaperDate)) {
        const key = `${lead.city}|${lead.date}|${lead.org_name}|${lead.event_topic}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(lead);
      }
    }
  }
}

const csv = [
  "city,date,org_name,event_topic",
  ...rows.map((row) => [
    row.city,
    row.date,
    row.org_name,
    row.event_topic
  ].map(csvEscape).join(","))
].join("\n");

await fs.writeFile(outputPath, `${csv}\n`);
console.log(`Wrote ${rows.length} event leads to ${path.relative(process.cwd(), outputPath)}`);

function extractLeads(text, city, newspaperDate) {
  const lines = normalizeText(text).split("\n").filter((line) => line.trim().length >= 8);
  const leads = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const windowText = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
    if (!hasAny(windowText, EVENT_PATTERNS)) continue;
    if (hasAny(line, IGNORE_PATTERNS) && !hasAny(windowText, ["सम्मान", "पुरस्कार", "समारोह"])) continue;

    const org = findOrgName(windowText);
    const topic = findEventTopic(windowText);
    if (!org || !topic) continue;

    leads.push({
      city,
      date: findDate(windowText) || newspaperDate,
      org_name: org,
      event_topic: topic
    });
  }

  return leads;
}

function findOrgName(text) {
  const escapedClues = ORG_CLUES.map(escapeRegex).join("|");
  const pattern = new RegExp(`([\\p{Script=Devanagari}A-Za-z0-9&.() -]{2,90}(?:${escapedClues}))`, "gu");
  const matches = Array.from(text.matchAll(pattern)).map((match) => cleanChunk(match[1]));
  const usable = matches
    .map(trimToOrg)
    .filter((value) => value.length >= 3 && !hasAny(value, EVENT_PATTERNS));
  return usable[0] || "";
}

function trimToOrg(value) {
  const tokens = value.split(/\s+/).filter(Boolean);
  return tokens.slice(Math.max(0, tokens.length - 7)).join(" ");
}

function findEventTopic(text) {
  const highPriority = EVENT_PATTERNS.find((pattern) => text.includes(pattern));
  if (!highPriority) return "";

  const sentence = text
    .split(/[।|.!?]/)
    .map(cleanChunk)
    .find((part) => part.includes(highPriority));

  if (!sentence) return highPriority;
  const compact = sentence.split(/\s+/).slice(0, 14).join(" ");
  return compact.length > highPriority.length ? compact : highPriority;
}

function findDate(text) {
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  return "";
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function cleanChunk(value) {
  return value
    .replace(/[^\p{Script=Devanagari}A-Za-z0-9&.() /-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function titleCaseSlug(slug) {
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvEscape(value) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
