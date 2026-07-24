/**
 * Normalize uploaded case files → comma-CSV for n8n CSV Import (PRD 05).
 * Supports .csv / .tsv / semicolon-delimited / .xlsx / .xls (first sheet).
 */

import * as XLSX from "xlsx";

const MAX_BYTES = 2 * 1024 * 1024; // match n8n webhook entry default

const TEXT_EXTS = new Set([".csv", ".tsv", ".txt"]);
const SHEET_EXTS = new Set([".xlsx", ".xls"]);

export type CaseFileResult =
  | { ok: true; csv_text: string; csv_filename: string; source: string }
  | { ok: false; code: string; message: string };

function extOf(name: string): string {
  const m = name.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function stripBom(text: string): string {
  if (!text) return text;
  // UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  // UTF-16 LE BOM mis-decoded as two chars, or leftover \uFEFF
  if (text.startsWith("\uFEFF")) return text.slice(1);
  return text;
}

/** First non-empty line (for delimiter sniff). */
function firstDataLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) return line;
  }
  return "";
}

/**
 * Detect delimiter from the header line.
 * Prefer tab if dominant; else semicolon if more than commas (Excel EU).
 */
export function detectDelimiter(headerLine: string): "," | "\t" | ";" {
  let commas = 0;
  let tabs = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const c = headerLine[i];
    if (inQuotes) {
      if (c === '"') {
        if (headerLine[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") commas++;
    else if (c === "\t") tabs++;
    else if (c === ";") semis++;
  }
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** RFC-style parse with a single-char delimiter. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else if (c === "\r") {
      /* skip */
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function escapeCsvField(cell: string): string {
  if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function rowsToCommaCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => escapeCsvField(String(c ?? ""))).join(",")).join("\n");
}

/** Strip BOM; if TSV/semicolon, rewrite as comma-CSV. Already-comma left as-is (minus BOM). */
export function normalizeDelimitedText(raw: string): string {
  const text = stripBom(raw);
  if (!text.trim()) return "";
  const delim = detectDelimiter(firstDataLine(text));
  if (delim === ",") return text;
  return rowsToCommaCsv(parseDelimited(text, delim));
}

function sheetBufferToCsv(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("Workbook has no sheets");
  const sheet = wb.Sheets[name];
  // First sheet only (documented).
  return XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
}

export function isAllowedCaseFilename(filename: string): boolean {
  const ext = extOf(filename);
  return TEXT_EXTS.has(ext) || SHEET_EXTS.has(ext);
}

/** Windows often reports CSV as application/vnd.ms-excel; empty type is fine. */
export function isAllowedCaseMime(type: string, filename: string): boolean {
  if (!type || type === "application/octet-stream") return true;
  const t = type.toLowerCase();
  if (
    t.includes("csv") ||
    t.includes("tab-separated") ||
    t.startsWith("text/") ||
    t.includes("spreadsheet") ||
    t.includes("excel") ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return true;
  }
  // Trust extension when MIME is odd
  return isAllowedCaseFilename(filename);
}

/**
 * Convert uploaded bytes (or already-text) into comma-CSV for n8n.
 */
export function caseFileToCsvText(opts: {
  filename: string;
  buffer?: Buffer;
  text?: string;
}): CaseFileResult {
  const filename = (opts.filename || "cases.csv").trim() || "cases.csv";
  const ext = extOf(filename);

  if (opts.buffer && opts.buffer.byteLength > MAX_BYTES) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `File exceeds ${MAX_BYTES} bytes`,
    };
  }
  if (opts.text && Buffer.byteLength(opts.text, "utf8") > MAX_BYTES) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `CSV exceeds ${MAX_BYTES} bytes`,
    };
  }

  if (SHEET_EXTS.has(ext)) {
    if (!opts.buffer || opts.buffer.byteLength === 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Spreadsheet file is empty or unreadable",
      };
    }
    try {
      const csv = stripBom(sheetBufferToCsv(opts.buffer)).trim();
      if (!csv) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "First sheet is empty (no rows)",
        };
      }
      return {
        ok: true,
        csv_text: csv,
        csv_filename: filename.replace(/\.(xlsx|xls)$/i, ".csv"),
        source: ext === ".xls" ? "xls" : "xlsx",
      };
    } catch (e) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message:
          e instanceof Error
            ? `Could not parse spreadsheet: ${e.message}`
            : "Could not parse spreadsheet",
      };
    }
  }

  if (ext && !TEXT_EXTS.has(ext) && !SHEET_EXTS.has(ext)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Unsupported file type. Use .csv, .tsv, .xlsx, or .xls",
    };
  }

  let raw = opts.text;
  if (raw == null && opts.buffer) {
    raw = opts.buffer.toString("utf8");
  }
  if (raw == null) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "No file content",
    };
  }

  // UTF-16 LE Excel CSV often has many \0 — reject with a clear hint
  if (raw.includes("\0") || (opts.buffer && looksLikeUtf16(opts.buffer))) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message:
        "File looks like UTF-16. Re-save as UTF-8 CSV, or upload .xlsx instead",
    };
  }

  const csv_text = normalizeDelimitedText(raw);
  if (!csv_text.trim()) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "File is empty or unreadable",
    };
  }

  return {
    ok: true,
    csv_text,
    csv_filename: filename,
    source: ext === ".tsv" ? "tsv" : "csv",
  };
}

function looksLikeUtf16(buf: Buffer): boolean {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return true;
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return true;
  // Heuristic: many NULs in first 64 bytes
  const n = Math.min(64, buf.length);
  let nuls = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) nuls++;
  return nuls > n / 4;
}
