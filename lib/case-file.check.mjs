/**
 * ponytail: one runnable check for case-file normalize (no test framework).
 * Run: node --experimental-strip-types lib/case-file.check.mjs
 * or after build/types: npx tsx lib/case-file.check.ts — use .mjs with inlined asserts below.
 */
import assert from "node:assert/strict";

// Inline mirrors of detectDelimiter / normalize so this runs without tsx/xlsx.
function stripBom(text) {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function detectDelimiter(headerLine) {
  let commas = 0,
    tabs = 0,
    semis = 0;
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

function parseDelimited(text, delim) {
  const rows = [];
  let field = "",
    row = [],
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else if (c === "\r") {
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function escapeCsvField(cell) {
  if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function rowsToCommaCsv(rows) {
  return rows.map((r) => r.map((c) => escapeCsvField(String(c ?? ""))).join(",")).join("\n");
}

function normalizeDelimitedText(raw) {
  const text = stripBom(raw);
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = detectDelimiter(first);
  if (delim === ",") return text;
  return rowsToCommaCsv(parseDelimited(text, delim));
}

assert.equal(detectDelimiter("id,title,steps"), ",");
assert.equal(detectDelimiter("id;title;steps"), ";");
assert.equal(detectDelimiter("id\ttitle\tsteps"), "\t");
assert.equal(detectDelimiter('"a;b";title;x'), ";");

const bom = "\uFEFFid,title\n1,Login";
assert.equal(stripBom(bom).startsWith("id"), true);

const semi = normalizeDelimitedText("id;title;steps\nTC-1;Login;Open /login");
assert.equal(semi.split("\n")[0], "id,title,steps");
assert.ok(semi.includes("TC-1,Login,Open /login"));

const tsv = normalizeDelimitedText("id\ttitle\nTC-1\tLogin");
assert.equal(tsv, "id,title\nTC-1,Login");

const quoted = normalizeDelimitedText('id;title\nTC-1;"Hello; world"');
assert.ok(quoted.includes('"Hello; world"') || quoted.includes("Hello; world"));

console.log("case-file.check: ok");
