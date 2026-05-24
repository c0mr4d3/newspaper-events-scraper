import fs from "node:fs/promises";
import path from "node:path";

const HEADERS = [
  "source",
  "slug",
  "edition_id",
  "date",
  "status",
  "expected_pages",
  "saved_pages",
  "failed_pages",
  "invalid_pages",
  "started_at",
  "finished_at",
  "output_dir",
  "message"
];

export async function readStatusCsv(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });

  if (!raw.trim()) return [];
  const rows = parseCsv(raw);
  const headers = rows.shift();
  if (!headers) return [];

  return rows
    .filter((row) => row.some((value) => value !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

export async function getComboStatus(filePath, combo) {
  const rows = await readStatusCsv(filePath);
  return rows.find((row) => comboKey(row) === comboKey(combo)) || null;
}

export async function upsertComboStatus(filePath, row) {
  const rows = await readStatusCsv(filePath);
  const nextRow = normalizeRow(row);
  const key = comboKey(nextRow);
  const index = rows.findIndex((existing) => comboKey(existing) === key);

  if (index >= 0) rows[index] = { ...rows[index], ...nextRow };
  else rows.push(nextRow);

  rows.sort((a, b) => comboKey(a).localeCompare(comboKey(b)));
  await writeStatusCsv(filePath, rows);
}

export function makeCombo(source, edition, date) {
  return {
    source,
    slug: edition.slug,
    edition_id: String(edition.edition_id),
    date
  };
}

function normalizeRow(row) {
  const normalized = {};
  for (const header of HEADERS) {
    normalized[header] = row[header] === undefined || row[header] === null ? "" : String(row[header]);
  }
  return normalized;
}

function comboKey(row) {
  return `${row.source}|${row.slug}|${row.edition_id}|${row.date}`;
}

async function writeStatusCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = [
    HEADERS.join(","),
    ...rows.map((row) => HEADERS.map((header) => csvEscape(row[header] || "")).join(","))
  ];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`);
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function csvEscape(value) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
